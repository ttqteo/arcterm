// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of the run cards Chat draws for every run a conversation started
// (docs/superpowers/specs/2026-11-12-chat-verdict-handoff-design.md, sections 4 and 5): which `wsh runs start` call
// started which run, which runs belong to the conversation, where each card sits, what a queued start says, and the
// `[arc] Run <id> landed|held` message wavesrv types into the session when a run ends. The cards draw in
// chatruncard.tsx, the conversation (chatconversation.tsx) places them.

import { normPath } from "./agentsidebarmodel";
import { shortRunId } from "./brainstormrunmodel";
import type { RunCardView } from "./chatbrainstorm";

/** What a `wsh runs start` call's output names: a run that began at once, or a start the queue holds. */
export type RunAnchor = { kind: "started"; runId: string } | { kind: "queued"; entryId: string };

// `wsh runs start` as a command: through a path (`~/.arc/bin/wsh`, `wsh.exe`), in quotes, after `cd x &&`, inside
// `$(…)`; not `wsh runs start-now`, `wsh runs queue …`, or another program's words.
const RUNS_START_COMMAND = /(?:^|[\s;&|(])["']?(?:[^\s"';&|()]*[\\/])?wsh(?:\.exe)?["']?\s+runs\s+start(?=\s|$)/;

// the lines `wsh runs start` prints (cmd/wsh/cmd/wshcmd-runs.go): `started run <id> (<mode>, <status>) in <channel>`
// for a run that began, and `queued <id>` for a start the queue took, alone or followed by ` (#n in line) — …`,
// ` — blocked: …` or ` — and started already: …`. Only a line that begins with the word counts: a run list, an error
// or a hint that merely quotes an id does not.
const STARTED_LINE = /^[ \t]*started run ([A-Za-z0-9][A-Za-z0-9-]*)(?=\s|$)/m;
const QUEUED_LINE = /^[ \t]*queued ([A-Za-z0-9][A-Za-z0-9_-]*)(?=\s|$)/m;

/** The run (or queued start) a Bash call began: the call must be `wsh runs start` and its output must carry the
 *  started or queued line. When one command starts several runs, only the first is named. */
export function runStartAnchor(command: string, output: string): RunAnchor | null {
    if (!RUNS_START_COMMAND.test(command)) {
        return null;
    }
    const started = STARTED_LINE.exec(output);
    const queued = QUEUED_LINE.exec(output);
    if (started != null && (queued == null || started.index <= queued.index)) {
        return { kind: "started", runId: started[1] };
    }
    return queued != null ? { kind: "queued", entryId: queued[1] } : null;
}

/** The ids of a conversation's runs: those whose origin transcript is this one (a tab spans `/clear`, resumed
 *  sessions and forks, so the transcript, not the tab, says whose they are), plus the brainstorm's run, which a run
 *  from the cockpit launcher has no origin for. Oldest first, each id once. */
export function conversationRuns(
    transcriptPath: string | undefined,
    runs: readonly Pick<Run, "oid" | "origintranscript" | "createdts">[],
    brainstormRun?: string | null
): string[] {
    const here = transcriptPath ? normPath(transcriptPath) : "";
    const ids: string[] = [];
    const mine = runs
        .filter(
            (r) =>
                r.oid === brainstormRun ||
                (here !== "" && !!r.origintranscript && normPath(r.origintranscript) === here)
        )
        .sort((a, b) => a.createdts - b.createdts);
    for (const r of mine) {
        if (!ids.includes(r.oid)) {
            ids.push(r.oid);
        }
    }
    if (brainstormRun && !ids.includes(brainstormRun)) {
        ids.push(brainstormRun);
    }
    return ids;
}

/** What a run card at one `wsh runs start` call draws: a run, or a queued start (`runId` once the queue let it go and
 *  the run it became is known; none while it waits, or when it left the queue with no run to be found). */
export type RunCardSlot = { runId: string } | { entryId: string; runId?: string };

/** Where each run of the conversation draws.
 *
 *  - `anchors`: the `runstart` parts, `order` growing with the conversation. `order` is when the call ran, in ms
 *    (its record's time), so a run created before it is not that call's; with no time, a place in the conversation
 *    does as well, for such a number is far below any run's `createdTs` and rules no run out. Use one kind per call.
 *  - `runs`: the conversation's runs (`conversationRuns`), with the `createdTs` the store has for them.
 *  - `queued` and `started`: the run queue (`runQueueAtom`) and the run each entry became (`runQueueStartedAtom`).
 *
 *  A started anchor draws its run's card, even when the store has not listed that run yet: the agent's own call names
 *  it. A queued anchor draws the entry's card while it is queued; once it left the queue, the card follows the run
 *  `started` names, else the oldest run of the conversation created after the call that no call names (the started
 *  record is lost with a reload, so this finds the run again). The brainstorm's run keeps its brainstorm place and is
 *  drawn nowhere here. A run is drawn once: the first call (by `order`) that names it keeps it. `trailing` is every run
 *  of the conversation no call names, oldest first, for the end of the conversation. */
export function placeRunCards(i: {
    anchors: readonly { key: string; anchor: RunAnchor; order: number }[];
    runs: readonly { runId: string; createdTs?: number }[];
    brainstormRun?: string | null;
    queued: readonly Pick<RunQueueEntry, "id">[];
    started: Readonly<Record<string, string>>;
}): { byAnchor: Map<string, RunCardSlot>; trailing: string[] } {
    const byAnchor = new Map<string, RunCardSlot>();
    const anchors = [...i.anchors].sort((a, b) => a.order - b.order);
    const claimed = new Set<string>();
    if (i.brainstormRun) {
        claimed.add(i.brainstormRun);
    }
    // a run is drawn for the first call that names it; the brainstorm's run, claimed above, for none
    const take = (runId: string): boolean => {
        if (claimed.has(runId)) {
            return false;
        }
        claimed.add(runId);
        return true;
    };
    for (const { key, anchor } of anchors) {
        if (anchor.kind === "started" && take(anchor.runId)) {
            byAnchor.set(key, { runId: anchor.runId });
        }
    }
    const inQueue = new Set(i.queued.map((e) => e.id));
    const lost: { key: string; entryId: string; order: number }[] = [];
    for (const { key, anchor, order } of anchors) {
        if (anchor.kind !== "queued") {
            continue;
        }
        const { entryId } = anchor;
        const runId = i.started[entryId];
        if (inQueue.has(entryId)) {
            byAnchor.set(key, { entryId });
        } else if (runId !== undefined && take(runId)) {
            byAnchor.set(key, { entryId, runId });
        } else {
            lost.push({ key, entryId, order });
        }
    }
    // a run with no time is later than every call: nothing says it is not
    const time = (r: { createdTs?: number }) => r.createdTs ?? Infinity;
    const oldestFirst = [...i.runs].sort((a, b) => (time(a) < time(b) ? -1 : time(a) > time(b) ? 1 : 0));
    for (const { key, entryId, order } of lost) {
        const run = oldestFirst.find((r) => !claimed.has(r.runId) && time(r) >= order);
        if (run !== undefined) {
            claimed.add(run.runId);
            byAnchor.set(key, { entryId, runId: run.runId });
        } else {
            byAnchor.set(key, { entryId });
        }
    }
    return { byAnchor, trailing: oldestFirst.map((r) => r.runId).filter((id) => !claimed.has(id)) };
}

/** Where a queued start stands: waiting for room (or after a run), blocked, started as a run, or gone (it left the
 *  queue and no run is known, a removed entry). */
export type QueuedView =
    | { state: "waiting"; after?: string }
    | { state: "blocked"; reason: string }
    | { state: "started"; runId: string }
    | { state: "gone" };

/** Reads one queued start from the queue. `after` names the run (or entry) it waits on by `afterTitle`, its short id
 *  when no title is known. An entry still in the queue is read from it, whatever `started` says. */
export function queuedView(
    entryId: string,
    queue: readonly RunQueueEntry[],
    started: Readonly<Record<string, string>>,
    afterTitle: (runOrEntryId: string) => string | undefined
): QueuedView {
    const entry = queue.find((e) => e.id === entryId);
    if (entry != null) {
        if (entry.state === "blocked") {
            return { state: "blocked", reason: entry.reason ?? "" };
        }
        return entry.after
            ? { state: "waiting", after: afterTitle(entry.after) || shortRunId(entry.after) }
            : { state: "waiting" };
    }
    const runId = started[entryId];
    return runId !== undefined ? { state: "started", runId } : { state: "gone" };
}

/** The queued card's line: "Queued", "Queued · after <title>" or "Queued · blocked: <reason>". A start that began
 *  shows its run's own stage, and a gone one nothing, so both read "". */
export function queuedLabel(v: QueuedView): string {
    switch (v.state) {
        case "waiting":
            return v.after ? `Queued · after ${v.after}` : "Queued";
        case "blocked":
            return v.reason ? `Queued · blocked: ${v.reason}` : "Queued · blocked";
        case "started":
        case "gone":
            return "";
    }
}

/** The message wavesrv types into the session a run came from when that run ends (`originMessage`,
 *  pkg/wshrpc/wshserver/wshserver_originnotify.go), read: the run's first 8 characters, whether it landed, the rest of
 *  the first line (what merged, or why it was held; no full stop), and the whole message as written. */
export type RunEnded = { id8: string; landed: boolean; detail: string; text: string };

// `[arc] Run <id8>`, an optional goal as Go's %q wrote it, then `landed: …`, `held: …` or `held.`, all on the first line
const RUN_ENDED_LINE = /^\[arc\] Run ([0-9a-f]{8})(?: "(?:[^"\\]|\\.)*")? (?:(landed): (.*)|(held): (.*)|(held)\.)$/;

export function parseRunEnded(text: string): RunEnded | null {
    const firstLine = text.split(/\r?\n/, 1)[0];
    const m = RUN_ENDED_LINE.exec(firstLine);
    if (m == null) {
        return null;
    }
    const detail = (m[3] ?? m[5] ?? "").trim().replace(/\.$/, "");
    return { id8: m[1], landed: m[2] === "landed", detail, text };
}

/** Which of your messages are run-ended messages of a run of this conversation: by their fixed prefix and the run's
 *  id, not through a send record. `messages` are the conversation's messages in order, `runIds` the runs that draw a
 *  card (the brainstorm's too). A message that names no such run stays a bubble. A run can have several (held, then
 *  landed): all are paired, in the order given, so the last one says where the run ended. */
export function pairRunEnded(
    messages: readonly { key: string; text: string }[],
    runIds: readonly string[]
): Map<string, { runId: string; ended: RunEnded }> {
    const paired = new Map<string, { runId: string; ended: RunEnded }>();
    for (const { key, text } of messages) {
        const ended = parseRunEnded(text);
        const runId = ended == null ? undefined : runIds.find((id) => id.startsWith(ended.id8));
        if (ended != null && runId !== undefined) {
            paired.set(key, { runId, ended });
        }
    }
    return paired;
}

/** The run card's ✓ row text once it ended: "Run 3fa21b0c landed · merged into main" or "Run 3fa21b0c held: <reason>". */
export function runEndedLine(runId: string, ended: RunEnded): string {
    const id = `Run ${shortRunId(runId)}`;
    if (ended.landed) {
        return ended.detail !== "" ? `${id} landed · ${ended.detail}` : `${id} landed`;
    }
    return ended.detail !== "" ? `${id} held: ${ended.detail}` : `${id} held`;
}

/** Whether a run card folds into its ✓ row: its run is over (landed, complete, cancelled), or its run-ended message
 *  came. A held run never reaches a done stage, so the paired message is what folds it. */
export function runCardFolded(view: Pick<RunCardView, "done">, ended?: RunEnded | null): boolean {
    return view.done || ended != null;
}
