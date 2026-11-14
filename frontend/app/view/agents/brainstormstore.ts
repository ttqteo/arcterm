// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Per-agent brainstorm state, all in one map: the poller reads every attached brainstorm, and the tree line and
// the attention popup need unfocused agents' questions, so the set must be enumerable as well as keyed.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { sameRepoPath } from "@/util/paths";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { AgentsViewModel } from "./agents";
import {
    boardNames,
    brainstormBandModel,
    parseSeenBoards,
    seenNamesOf,
    withBoardSeen,
    withSeenBoards,
    type BrainstormBandModel,
    type SeenBoards,
} from "./brainstormband";
import {
    brainstormFilePath,
    seenMark,
    shownFile,
    withStartingRun,
    type BrainstormFile,
    type SeenMark,
    type SentLine,
    type StartingRunMark,
} from "./brainstormmodel";
import type { CanvasBoard } from "./canvasmodel";

export type BrainstormState = {
    topic: string;
    path: string;
    cwd: string;
    mode: "terminal" | "brainstorm";
    // the last good contents: a read that fails to parse never replaces them
    file: BrainstormFile | null;
    // shown only after two consecutive failed reads, so an agent mid-write never flashes an error
    error: string | null;
    failedReads: number;
    removed: boolean;
    modifiedMs: number | null;
    // when brainstorm mode was last shown: the compaction banner and the unseen mark compare against it
    lastViewedMs: number;
    board: string | null;
    // "Open the design" pressed on the exited card
    showDesign: boolean;
    // the design opened over the question or the working note; kept here so a board's Back returns to it
    designOpen: boolean;
    boards: CanvasBoard[];
    // where wavesrv serves the project's design folder; null until the poller has asked it to
    base: string | null;
    // the last line Arc sent, until the agent has taken it (the poller settles it)
    sent: SentLine | null;
    // the send time of the last `brainstorm: check` the agent took, until Arc's check record is newer than it: with
    // none newer, the agent ended its turn without starting the check
    sentCheckAt: number | null;
    // the check review's cursor row and the rows opened to their was/now; here because the keybindings and the
    // asking rail's links act on them from outside the review
    review: { cursor: string | null; open: Record<string, boolean> };
    // a run Approve is starting, until the file records it (withStartingRun); in memory, so a reload drops it
    starting: StartingRunMark | null;
};

// what every view draws: the file, with a pending sent line read as the agent writing, and the run Arc started from
// it before the agent has written it down
export function shownBrainstormFile(s: BrainstormState | null | undefined): BrainstormFile | null {
    return s?.file != null ? withStartingRun(shownFile(s.file, s.sent), s.starting ?? null) : null;
}

// the run's start, for the brainstorm at `path` only: a brainstorm attached in its place meanwhile is not the one
// that was approved
export function setStartingRun(agentId: string, path: string, starting: StartingRunMark | null): void {
    updateBrainstorm(agentId, (s) => (s.path === path ? { ...s, starting } : s));
}

// the tab meta key holding the attached brainstorm.json's absolute path
export const SESSION_BRAINSTORM = "session:brainstorm";

export const brainstormsAtom = atom<Record<string, BrainstormState>>({}) as PrimitiveAtom<
    Record<string, BrainstormState>
>;

export const brainstormAtom = atomFamily(
    (agentId: string): Atom<BrainstormState | null> => atom((get) => get(brainstormsAtom)[agentId] ?? null)
);

export function getBrainstorm(agentId: string): BrainstormState | null {
    return globalStore.get(brainstormsAtom)[agentId] ?? null;
}

export function updateBrainstorm(agentId: string, fn: (s: BrainstormState) => BrainstormState): void {
    const all = globalStore.get(brainstormsAtom);
    const s = all[agentId];
    if (s != null) {
        globalStore.set(brainstormsAtom, { ...all, [agentId]: fn(s) });
    }
}

// what the user has seen of each brainstorm, keyed by its file's path: apart from the per-agent state, so a resume in a
// new agent, or the pane's remount on a surface switch, keeps it
export const brainstormSeenAtom = atom<Record<string, SeenMark>>({}) as PrimitiveAtom<Record<string, SeenMark>>;

export function markBrainstormSeen(path: string, f: BrainstormFile): void {
    globalStore.set(brainstormSeenAtom, { ...globalStore.get(brainstormSeenAtom), [path]: seenMark(f) });
}

// the first read is what the user is taken to have seen: what is new is measured from there
export function baselineBrainstormSeen(path: string, f: BrainstormFile): void {
    if (!(path in globalStore.get(brainstormSeenAtom))) {
        markBrainstormSeen(path, f);
    }
}

// The board names the user has seen per brainstorm.json path, in localStorage so a reload and a restart keep them (the
// in-memory BrainstormState is rebuilt with `lastViewedMs: now` and could not). A path with no entry has seen nothing:
// its boards are all new. Said once when the storage cannot be read or written, as chatbrainstormstore.ts does.
export const SEEN_BOARDS_KEY = "chat.brainstorm.seenBoards";

let warned = false;
function warnOnce(what: string, e: unknown): void {
    if (!warned) {
        warned = true;
        console.warn(`[chat] brainstorm seen boards not ${what}:`, e instanceof Error ? e.message : String(e));
    }
}

function readSeenBoards(): SeenBoards {
    try {
        return parseSeenBoards(globalThis.localStorage?.getItem(SEEN_BOARDS_KEY));
    } catch (e) {
        warnOnce("read", e);
        return {};
    }
}

export const brainstormSeenBoardsAtom = atom<SeenBoards>(readSeenBoards()) as PrimitiveAtom<SeenBoards>;

/** Takes the board names of `f` as seen for the brainstorm at `path`, at `now`. Writes nothing when they are the names
 *  already stored; a storage that cannot be written leaves them in memory. */
export function markBoardsSeen(path: string, f: BrainstormFile, now: number): void {
    saveSeenBoards((prev) => withSeenBoards(prev, path, boardNames(f), now));
}

/** Takes the one board `name` as seen for the brainstorm at `path`: Chat's band opened it without the Brainstorm tab. */
export function markBoardSeen(path: string, name: string, now: number): void {
    saveSeenBoards((prev) => withBoardSeen(prev, path, name, now));
}

function saveSeenBoards(fn: (prev: SeenBoards) => SeenBoards): void {
    const prev = globalStore.get(brainstormSeenBoardsAtom);
    const next = fn(prev);
    if (next === prev) {
        return;
    }
    globalStore.set(brainstormSeenBoardsAtom, next);
    try {
        globalThis.localStorage?.setItem(SEEN_BOARDS_KEY, JSON.stringify(next));
    } catch (e) {
        warnOnce("saved", e);
    }
}

/** What the Chat band's brainstorm part draws for one agent: null while no brainstorm is attached or its file has not been
 *  read. It reads the file as it was read (not `shownBrainstormFile`: the boards are the same, and the sent-line overlay
 *  is no business of the store). The model is kept while neither the file nor the seen names changed, so a view that reads
 *  it is not redrawn by every other change of the state. */
export const brainstormBandAtom = atomFamily((agentId: string): Atom<BrainstormBandModel | null> => {
    let last: { file: BrainstormFile; seen: readonly string[] | null; model: BrainstormBandModel } | null = null;
    return atom((get) => {
        const s = get(brainstormAtom(agentId));
        if (s?.file == null) {
            return null;
        }
        const seen = seenNamesOf(get(brainstormSeenBoardsAtom), s.path);
        if (last == null || last.file !== s.file || last.seen !== seen) {
            last = { file: s.file, seen, model: brainstormBandModel(s.file, seen) };
        }
        return last.model;
    });
});

// one brainstorm per agent: the agent reveals on every write, so the same one keeps its state, and any other
// (a new topic, or the same topic in another project) starts over in its place. The project is compared as a path, not
// as text: one registered as C:/x and a terminal's C:\x reveal are one project, and starting the pane over in terminal
// mode on each such reveal would throw its state away.
export function attachBrainstorm(agentId: string, a: { topic: string; cwd: string }, now: number): void {
    const prev = getBrainstorm(agentId);
    if (prev != null && prev.topic === a.topic && sameRepoPath(prev.cwd, a.cwd)) {
        return;
    }
    const next: BrainstormState = {
        topic: a.topic,
        path: brainstormFilePath(a.cwd, a.topic),
        cwd: a.cwd,
        mode: "terminal",
        file: null,
        error: null,
        failedReads: 0,
        removed: false,
        modifiedMs: null,
        lastViewedMs: now,
        board: null,
        showDesign: false,
        designOpen: false,
        boards: [],
        base: null,
        sent: null,
        sentCheckAt: null,
        review: { cursor: null, open: {} },
        starting: null,
    };
    globalStore.set(brainstormsAtom, { ...globalStore.get(brainstormsAtom), [agentId]: next });
}

export function detachBrainstorm(agentId: string): void {
    const all = globalStore.get(brainstormsAtom);
    if (agentId in all) {
        const { [agentId]: _gone, ...rest } = all;
        globalStore.set(brainstormsAtom, rest);
    }
}

// the tab meta is what re-attaches a brainstorm after a restart, so a dismissed one has to lose it too
export async function dismissBrainstorm(agentId: string): Promise<void> {
    detachBrainstorm(agentId);
    try {
        await RpcApi.SetMetaCommand(TabRpcClient, { oref: `tab:${agentId}`, meta: { [SESSION_BRAINSTORM]: null } });
    } catch (e) {
        console.warn("brainstorm dismiss: clearing session:brainstorm failed", agentId, e);
    }
}

export function brainstormOwner(topic: string): string | null {
    const all = globalStore.get(brainstormsAtom);
    return Object.keys(all).find((id) => all[id].topic === topic) ?? null;
}

// opening the Brainstorm tab is when the user is taken to have seen its boards
export function setBrainstormMode(agentId: string, mode: "terminal" | "brainstorm", now: number): void {
    updateBrainstorm(agentId, (s) => (mode === "brainstorm" ? { ...s, mode, lastViewedMs: now } : { ...s, mode }));
    if (mode === "brainstorm") {
        const s = getBrainstorm(agentId);
        if (s?.file != null) {
            markBoardsSeen(s.path, s.file, now);
        }
    }
}

export function openBrainstormBoard(agentId: string, board: string | null): void {
    updateBrainstorm(agentId, (s) => ({ ...s, board }));
}

export function openBrainstormDesign(agentId: string, open: boolean): void {
    updateBrainstorm(agentId, (s) => ({ ...s, designOpen: open }));
}

// ids is the review's rows in cursor order; a cursor not among them (none yet, or its row gone) starts at the first
export function moveReviewCursor(agentId: string, ids: string[], delta: 1 | -1): void {
    if (ids.length === 0) {
        return;
    }
    updateBrainstorm(agentId, (s) => {
        const at = s.review.cursor != null ? ids.indexOf(s.review.cursor) : -1;
        const next = at < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, at + delta));
        return { ...s, review: { ...s.review, cursor: ids[next] } };
    });
}

export function setReviewCursor(agentId: string, id: string): void {
    updateBrainstorm(agentId, (s) => ({ ...s, review: { ...s.review, cursor: id } }));
}

export function toggleReviewRow(agentId: string, id: string): void {
    updateBrainstorm(agentId, (s) => ({
        ...s,
        review: { ...s.review, open: { ...s.review.open, [id]: !s.review.open[id] } },
    }));
}

// read through the per-agent atom, the one watchFocusedCanvas (whenstate.ts) subscribes for the key predicates
export function focusedBrainstorm(model: AgentsViewModel): BrainstormState | null {
    const id = globalStore.get(model.focusIdAtom);
    return id ? globalStore.get(brainstormAtom(id)) : null;
}
