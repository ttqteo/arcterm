// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of the council cards Chat draws for a council the agent started
// (docs/superpowers/specs/2026-11-14-chat-council-design.md): which `wsh council start` call started which council,
// where each council's card sits, and what the card and the row it folds into say. Every state word and number is
// councilmodel.ts's (the Discussion's own), never a second reading of a council; the cards draw in chatcouncilcard.tsx,
// the councils are read in chatcouncilstore.ts and the conversation (chatconversation.tsx) places them.

import {
    askedParts,
    authorName,
    canRemoveCouncil,
    duration,
    elapsedMs,
    headerChip,
    panel,
    roundsOf,
    sentProposals,
    sentReplies,
    shownState,
    synthesisRound,
    UNTITLED_COUNCIL,
} from "./councilmodel";

/** What a `wsh council start` call's output names: a council that began, one the queue holds (another council runs),
 *  or one the Token burn gate refused, which was saved as not run. */
export type CouncilAnchor =
    // `estimate`: the cost the line quotes, as printed ("≈ 14 calls · ~0.9M tokens")
    | { kind: "started"; councilId: string; estimate?: string }
    | { kind: "queued"; councilId: string }
    // `reason`: the "Not run: …" line above the saved line, prefix included
    | { kind: "notrun"; councilId: string; reason: string };

// `wsh council start` as a command: through a path (`~/.arc/bin/wsh`, `wsh.exe`), in quotes, after `cd x &&`, inside
// `$(…)`; not `wsh council start-now`, `wsh council wait …`, or another program's words.
const COUNCIL_START_COMMAND = /(?:^|[\s;&|(])["']?(?:[^\s"';&|()]*[\\/])?wsh(?:\.exe)?["']?\s+council\s+start(?=\s|$)/;

// the lines `wsh council start` prints (cmd/wsh/cmd/wshcmd-council.go), each read from its start to its end so a line
// that merely quotes an id does not count (a council id is store.go's idRe):
//   councilStartedLine  `council <id> started: <feature> · <mode> · <group> · <seats> · ≈ N calls · ~X tokens`
//   councilQueuedLine   `Queued after <id> (<feature>) · council <id> starts by itself when it ends`: the id that
//                       starts is the new council's own, the one at the end of the line
//   councilNotRunText   `Not run: <reason>` and under it `council <id> saved as not run; Start council in the app runs it`
const ID = "([A-Za-z0-9_-]{1,64})";
const STARTED_LINE = new RegExp(`^[ \\t]*council ${ID} started: [^\\r\\n]*$`, "m");
const ESTIMATE = /(≈ \d+ calls? · ~\S+ tokens)[ \t]*$/;
const QUEUED_LINE = new RegExp(
    `^[ \\t]*Queued after [^\\r\\n]*· council ${ID} starts by itself when it ends[ \\t]*$`,
    "m"
);
const NOT_RUN_LINE = new RegExp(
    `^(?:[ \\t]*(Not run:[^\\r\\n]*)\\r?\\n)?[ \\t]*council ${ID} saved as not run(?=[;\\s]|$)`,
    "m"
);

/** The council a Bash call began: the call must be `wsh council start` and its output must carry the started, queued
 *  or saved-as-not-run line. When the output holds several, the first line wins. A not-run line with no `Not run:`
 *  line above it (the output was cut) reads `Not run` as its reason. */
export function councilStartAnchor(command: string, output: string): CouncilAnchor | null {
    if (!COUNCIL_START_COMMAND.test(command)) {
        return null;
    }
    const found: { index: number; anchor: CouncilAnchor }[] = [];
    const started = STARTED_LINE.exec(output);
    if (started != null) {
        const estimate = ESTIMATE.exec(started[0])?.[1];
        found.push({
            index: started.index,
            anchor: { kind: "started", councilId: started[1], ...(estimate != null ? { estimate } : {}) },
        });
    }
    const queued = QUEUED_LINE.exec(output);
    if (queued != null) {
        found.push({ index: queued.index, anchor: { kind: "queued", councilId: queued[1] } });
    }
    const notRun = NOT_RUN_LINE.exec(output);
    if (notRun != null) {
        found.push({
            index: notRun.index,
            anchor: { kind: "notrun", councilId: notRun[2], reason: notRun[1]?.trim() ?? "Not run" },
        });
    }
    found.sort((a, b) => a.index - b.index);
    return found[0]?.anchor ?? null;
}

// ---- where a council draws ----

/** Whether the council has ended once in this conversation (spec Builder decision 3): its anchor is a not-run line, it is
 *  in an ended state (done, stopped, failed, not run: the states nothing works on, `canRemoveCouncil`), it holds a
 *  summary (a follow-up after done runs a council that had one), or this app session saw it ended (`seenEnded`, which
 *  covers a stopped or failed council resumed since). Such a council stays a row at its call for good, whatever it does
 *  next; one that never ended is a card at the end of the conversation. */
export function councilEndedOnce(c: Council | null, anchor: CouncilAnchor, seenEnded: boolean): boolean {
    return anchor.kind === "notrun" || seenEnded || (c != null && (canRemoveCouncil(c) || c.summary != null));
}

/** Where each council of the conversation draws. `atCall` maps a `councilstart` part's key to the id of the council whose
 *  row draws there (one that ended once); `trailing` is the live councils' ids, oldest call first, for the end of the
 *  conversation. `anchors` are the conversation's `councilstart` parts, `order` growing with the conversation;
 *  `endedOnce` holds the ids `councilEndedOnce` says so of. A council is drawn once: the first call (by `order`) that
 *  names it keeps it. A council the store does not know (null, or missing) draws nothing, except one a not-run line
 *  names: its row is the anchor's own words and needs no council. */
export function placeCouncilCards(i: {
    anchors: readonly { key: string; anchor: CouncilAnchor; order: number }[];
    councils: ReadonlyMap<string, Council | null>;
    endedOnce: ReadonlySet<string>;
}): { atCall: Map<string, string>; trailing: string[] } {
    const atCall = new Map<string, string>();
    const trailing: string[] = [];
    const drawn = new Set<string>();
    for (const { key, anchor } of [...i.anchors].sort((a, b) => a.order - b.order)) {
        const id = anchor.councilId;
        const notRun = anchor.kind === "notrun";
        if (drawn.has(id) || (!notRun && i.councils.get(id) == null)) {
            continue;
        }
        drawn.add(id);
        if (notRun || i.endedOnce.has(id)) {
            atCall.set(key, id);
        } else {
            trailing.push(id);
        }
    }
    return { atCall, trailing };
}

// ---- what a card and a row say ----

/** The word every card and row head starts with. The row draws it in a stronger weight than the rest of the head
 *  (chatcouncilcard.tsx), so the heads are built from it rather than from a second copy of the string. */
export const COUNCIL_WORD = "Council";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// the mode the head names: Go reads an empty mode as review
const modeOf = (c: Council) => (c.mode === "brainstorm" ? "brainstorm" : "review");

// the time the council ran, as the Discussion words it; empty when nothing was timed (a council that never started)
function ranFor(c: Council, nowMs: number): string {
    const ms = elapsedMs(c, nowMs);
    return ms > 0 ? duration(ms) : "";
}

/** A seat's dot on the card: `working` while the council's `activity` has the seat, `done` once it sent in the current
 *  round, else `waiting`. */
export type SeatState = "done" | "working" | "waiting";

/** The panel's seats (never the coordinator) with the name the council shows and the state of the seat's dot. Round 1 is
 *  the ideas: a seat sent when one of its ideas reached the others (a held draft did not). A later round is the replies:
 *  a seat sent when a reply of its own, sent in that round, is there. In the summary's round the seats are read by the
 *  last round they answered; a follow-up's own round is read as it is. */
export function seatStates(c: Council): { id: string; name: string; state: SeatState }[] {
    const round = c.round === synthesisRound(c) ? roundsOf(c) : c.round;
    const sent = new Set(
        round <= 1
            ? sentProposals(c).map((p) => p.author)
            : sentReplies(c)
                  .filter((r) => r.round === round)
                  .map((r) => r.author)
    );
    return panel(c).map((e) => ({
        id: e.id,
        name: authorName(c, e.id),
        state: c.activity?.[e.id] != null ? "working" : sent.has(e.id) ? "done" : "waiting",
    }));
}

/** What the live card draws for a council that is queued, running or waiting on the person. `state` is the card's own
 *  (`data-chat-council-state`); `tag` is the header's state word; `line` is the waiting card's sentence; `estimate` is the
 *  cost the start line quoted. */
export interface CouncilCardView {
    state: "running" | "awaiting" | "queued";
    head: string;
    title: string;
    question: string;
    tag: string;
    seats: { id: string; name: string; state: SeatState }[];
    elapsed: string;
    estimate?: string;
    line?: string;
}

// the queued card's header word, from the council it waits for (null: not known, or not loaded yet)
function queuedTag(holder: Council | null): string {
    return holder == null
        ? "Queued · starts by itself"
        : `Queued after "${holder.feature.trim() || UNTITLED_COUNCIL}" · starts by itself`;
}

/** The card of a council that has not ended once. `holder` is the council a queued one waits for, `nowMs` the clock. The
 *  step word is the Discussion's header chip (`Round 2 of 3`, `Writing the summary`, `Follow-up`); there is no round name. */
export function councilCardView(
    c: Council,
    anchor: CouncilAnchor,
    holder: Council | null,
    nowMs: number
): CouncilCardView {
    const state = c.state === "awaiting-you" ? "awaiting" : c.state === "queued" ? "queued" : "running";
    // a council the agent started never holds drafts, so awaiting-you is the pause after round 1: who sent what
    const panelIds = new Set(panel(c).map((e) => e.id));
    const ideas = sentProposals(c).filter((p) => panelIds.has(p.author));
    const paused = `Paused after round 1 · ${count(new Set(ideas.map((p) => p.author)).size, "expert", "experts")} sent ${count(ideas.length, "idea", "ideas")}. Read them in the room, or go on.`;
    return {
        state,
        head: `${COUNCIL_WORD} · ${modeOf(c)}`,
        title: c.feature.trim() || UNTITLED_COUNCIL,
        question: askedParts(c.question).question,
        tag: state === "queued" ? queuedTag(holder) : headerChip(c),
        seats: seatStates(c),
        elapsed: ranFor(c, nowMs),
        ...(anchor.kind === "started" && anchor.estimate != null ? { estimate: anchor.estimate } : {}),
        ...(state === "awaiting" ? { line: paused } : {}),
    };
}

/** What the one-line row of a council that ended once says. `mark` is the glyph drawn in place of the ✓ (`working` is the
 *  green dot of a council running again); `head` and `text` are the row's strong start (its first word, COUNCIL_WORD, in a
 *  heavier weight) and its muted, cut-short part (the feature or the reason); `action` is the link at its right end: the
 *  report of a done council, else the council's room. */
export interface CouncilRowView {
    end: "done" | "stopped" | "failed" | "not-run" | "running";
    mark: "✓" | "■" | "!" | "–" | "working";
    head: string;
    text?: string;
    action: "report" | "open";
}

// one line of a reason: its words on a single line, nothing if there are none
const oneLine = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim() || undefined;

// the gate's refusal for the person: its first sentence, without the `Not run:` prefix (the rest speaks to the agent)
function refusalOf(anchor: CouncilAnchor): string | undefined {
    if (anchor.kind !== "notrun") {
        return undefined;
    }
    const first = anchor.reason.replace(/^\s*Not run:?\s*/i, "").split(/\.\s/)[0];
    return oneLine(first.replace(/\.$/, ""));
}

/** The row a council that has ended once folds into, at the call that started it. `c` is null only for a not-run line the
 *  store does not know: the row then reads the anchor alone. A stopped council that holds its summary reads as done
 *  (`shownState`); one that is running, queued or waiting again after it ended is a working row with its header chip. */
export function councilRowView(c: Council | null, anchor: CouncilAnchor, nowMs: number): CouncilRowView {
    if (c == null) {
        return {
            end: "not-run",
            mark: "–",
            head: `${COUNCIL_WORD} · not run`,
            text: refusalOf(anchor),
            action: "open",
        };
    }
    const state = shownState(c);
    const round = Math.max(1, c.round);
    switch (state) {
        case "done": {
            const noun = c.mode === "brainstorm" ? ["idea", "ideas"] : ["direction", "directions"];
            const head = [
                COUNCIL_WORD,
                modeOf(c),
                c.summary != null ? count(c.summary.directions.length, noun[0], noun[1]) : "",
                ranFor(c, nowMs),
            ];
            return {
                end: "done",
                mark: "✓",
                head: head.filter((s) => s !== "").join(" · "),
                text: oneLine(c.feature),
                action: "report",
            };
        }
        case "stopped":
            return {
                end: "stopped",
                mark: "■",
                head: `${COUNCIL_WORD} · stopped in round ${round}`,
                text: oneLine(c.error) ?? "The rounds that finished are kept",
                action: "open",
            };
        case "failed":
            return {
                end: "failed",
                mark: "!",
                head: `${COUNCIL_WORD} · failed in round ${round}`,
                text: oneLine(c.error),
                action: "open",
            };
        case "not-run":
            return {
                end: "not-run",
                mark: "–",
                head: `${COUNCIL_WORD} · not run`,
                text: refusalOf(anchor) ?? oneLine(c.error),
                action: "open",
            };
        default:
            return {
                end: "running",
                mark: "working",
                head: `${COUNCIL_WORD} · running again`,
                text: headerChip(c),
                action: "open",
            };
    }
}
