// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pairs (pkg/agentpair), as the Agent surface reads them: one list atom of the active pairs and one view atom per
// pair, read over wshrpc on first use and again whenever wavesrv says a pair changed (`pair:update`, published after every
// change). A project's history (every pair of it in every state, the ones synced from another machine too) is one more
// list per project, read the same way. What outlives a view is here too: which message the conversation scrolls to, and
// how many messages of each pair the person has seen (the header button's "N new"). Pure rules are in pairmodel.ts.
//
// The resting judges come with the same list answer (`resting` on PairListCommand): judges arcterm launched whose newest pair
// has ended. The tree hides one under its worker's row, Add judge wakes one, and closing a worker closes the ones asleep.
//
// The dev mock (devMockPairsAtom) is how a CDP scenario seeds pairs with no agent running: while it is set it replaces the
// server's answer whole, as devmock.ts's devMockAgentsAtom does the roster, and nothing is read from wavesrv. The resting
// list has its own mock (devMockRestingAtom), which replaces the server's list the same way.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue, type Atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { useEffect, useMemo } from "react";
import { councilProjectKey } from "./councilmodel";
import { pairOf, parseSeen } from "./pairmodel";

// two spellings of one project path (`D:\x`, `d:/x/`) share an atom, as the councils' lists do
const sameProject = (a: string, b: string) => councilProjectKey(a) === councilProjectKey(b);

// cast because a null initial value picks jotai's read-only overload under the non-strict tsconfig

/** null = no mock: the server's pairs. A non-null array (INCLUDING []) replaces them whole. */
export const devMockPairsAtom = atom<PairView[] | null>(null) as PrimitiveAtom<PairView[] | null>;

/** null = no mock: the server's resting judges. A non-null array (INCLUDING []) replaces them whole. */
export const devMockRestingAtom = atom<PairResting[] | null>(null) as PrimitiveAtom<PairResting[] | null>;

const serverPairsAtom = atom<PairInfo[] | null>(null) as PrimitiveAtom<PairInfo[] | null>;
const serverRestingAtom = atom<PairResting[]>([]) as PrimitiveAtom<PairResting[]>;
const serverViewAtom = atomFamily((_id: string) => atom<PairView | null>(null) as PrimitiveAtom<PairView | null>);
const serverHistoryAtom = atomFamily(
    (_project: string) => atom<PairInfo[] | null>(null) as PrimitiveAtom<PairInfo[] | null>,
    sameProject
);

/** The active pairs (not the ended or synced ones), empty before the first read. A PairView carries its PairInfo, so a
 *  mocked view stands for its row; a mocked pair that is ended or synced is left out, as the server's list leaves it. */
export const pairListAtom: Atom<PairInfo[]> = atom((get) => {
    const mock = get(devMockPairsAtom);
    return mock != null ? mock.filter((p) => p.state !== "ended" && !p.synced) : (get(serverPairsAtom) ?? []);
});

/** The resting judges: launched judges whose newest pair has ended, each with the working agent it last judged. Empty
 *  before the first read. The server's list, or the mock's while devMockRestingAtom is set. */
export const restingJudgesAtom: Atom<PairResting[]> = atom((get) => get(devMockRestingAtom) ?? get(serverRestingAtom));

/** A project's pairs in every state, ended and synced ones too ("" is every project), or null before the first read. The
 *  server lists them newest first; a mocked list keeps the mock's order. */
export const pairHistoryAtom = atomFamily(
    (project: string): Atom<PairInfo[] | null> =>
        atom((get) => {
            const mock = get(devMockPairsAtom);
            if (mock == null) {
                return get(serverHistoryAtom(project));
            }
            return mock.filter((p) => project === "" || sameProject(p.project, project));
        }),
    sameProject
);

/** One pair in full by id, or null before it is read (or when the mock holds no such pair). */
export const pairViewAtom = atomFamily(
    (id: string): Atom<PairView | null> =>
        atom((get) => {
            const mock = get(devMockPairsAtom);
            return mock != null ? (mock.find((v) => v.id === id) ?? null) : get(serverViewAtom(id));
        })
);

/** Why the last read of a pair failed, null while it has not or the last read was good: a view says so instead of
 *  loading for ever. Only loadPair writes it. */
export const pairViewErrorAtom = atomFamily((_id: string) => atom<string | null>(null) as PrimitiveAtom<string | null>);

/** The message the conversation scrolls to and clears: an agreed item's link sets it. */
export const pairScrollToAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

/** Text waiting to be put in a pair's composer: Judge again sets `@judge `. The composer takes it once (reads it, clears it
 *  to null, then types it in, focuses and puts the caret at its end), so it is not typed twice. null = nothing waiting. */
export const pairDraftAtom = atomFamily((_pairId: string) => atom<string | null>(null) as PrimitiveAtom<string | null>);

/** Resume: puts a stopped pair back to relaying and delivers what is still queued, with no message from the person. The
 *  server refuses a pair that is not stopped, a judges-gone stop and a pair with nothing to deliver, each with an error that
 *  says what to do instead. A failure is logged and thrown again, so the place that pressed the button shows it where it
 *  was pressed. On success nothing is read here: wavesrv's `pair:update` brings the pair's new state. */
export async function resumePair(pairId: string): Promise<void> {
    try {
        await RpcApi.PairResumeCommand(TabRpcClient, { pairid: pairId });
    } catch (err) {
        console.error(`resuming pair ${pairId} failed`, err);
        throw err;
    }
}

// ---- loading ----

const mocked = () => globalStore.get(devMockPairsAtom) != null;

// what has been read: an event only reads those again (atomFamily cannot be enumerated)
const knownPairs = new Set<string>();
// a read that an event overtakes must not be overwritten by the earlier read's late answer
const viewSeq = new Map<string, number>();
let listSeq = 0;
let firstList: Promise<void> | null = null;
// the histories read: project key -> the path as first read, and each one's latest read (as viewSeq is for a view)
const knownHistories = new Map<string, string>();
const historySeq = new Map<string, number>();

let subscribed = false;
function subscribePairUpdate() {
    if (subscribed) {
        return;
    }
    subscribed = true;
    waveEventSubscribeSingle({
        eventType: "pair:update",
        handler: (event) => {
            const data = event.data as PairUpdateData | undefined;
            void loadPairs();
            for (const project of knownHistories.values()) {
                void loadPairHistory(project);
            }
            // the pair it names, or every pair read when it names none
            for (const id of data != null ? [data.pairid] : knownPairs) {
                if (knownPairs.has(id)) {
                    void loadPair(id);
                }
            }
        },
    });
}

/** Reads the active pairs into the list atom, and the resting judges that come with them into theirs. A failure leaves
 *  both as they were and logs. */
export async function loadPairs(): Promise<void> {
    subscribePairUpdate();
    if (mocked()) {
        return;
    }
    const seq = ++listSeq;
    try {
        const rtn = await RpcApi.PairListCommand(TabRpcClient);
        if (seq === listSeq) {
            globalStore.set(serverPairsAtom, rtn?.pairs ?? []);
            // the server leaves `resting` out when it is empty
            globalStore.set(serverRestingAtom, rtn?.resting ?? []);
        }
    } catch (err) {
        console.error("loading the pairs failed", err);
    }
}

// the first use reads the list once, however many rows ask at the same time; the events keep it right after that
function ensurePairs(): Promise<void> {
    if (globalStore.get(serverPairsAtom) != null) {
        return Promise.resolve();
    }
    firstList ??= loadPairs().finally(() => {
        firstList = null;
    });
    return firstList;
}

/** Reads a project's pairs, in every state, into its history atom ("" is every project). A failure leaves the list as it
 *  was and logs. */
export async function loadPairHistory(project: string): Promise<void> {
    const key = councilProjectKey(project);
    if (!knownHistories.has(key)) {
        knownHistories.set(key, project);
    }
    subscribePairUpdate();
    if (mocked()) {
        return;
    }
    const seq = (historySeq.get(key) ?? 0) + 1;
    historySeq.set(key, seq);
    try {
        const rtn = await RpcApi.PairHistoryCommand(TabRpcClient, { project });
        if (historySeq.get(key) === seq) {
            globalStore.set(serverHistoryAtom(project), rtn?.pairs ?? []);
        }
    } catch (err) {
        console.error(`loading the pair history of ${project || "every project"} failed`, err);
    }
}

/** Reads one pair in full into its atom. A failure leaves the atom as it was, logs, and is kept in pairViewErrorAtom
 *  until a later read succeeds. */
export async function loadPair(id: string): Promise<void> {
    if (id === "") {
        return;
    }
    knownPairs.add(id);
    subscribePairUpdate();
    if (mocked()) {
        return;
    }
    const seq = (viewSeq.get(id) ?? 0) + 1;
    viewSeq.set(id, seq);
    try {
        const view = await RpcApi.PairGetCommand(TabRpcClient, { pairid: id });
        if (viewSeq.get(id) === seq) {
            globalStore.set(serverViewAtom(id), view);
            globalStore.set(pairViewErrorAtom(id), null);
        }
    } catch (err) {
        console.error(`loading pair ${id} failed`, err);
        if (viewSeq.get(id) === seq) {
            globalStore.set(pairViewErrorAtom(id), err instanceof Error ? err.message : String(err));
        }
    }
}

/** Reads a pair in full the first time anything asks for it, and never again from here: a pair that was read is kept right
 *  by `pair:update`. For a place that wants the views of many pairs by id (the marks in Chat) and would otherwise read
 *  them again on every render. */
export function ensurePair(id: string): void {
    if (id !== "" && !knownPairs.has(id)) {
        void loadPair(id);
    }
}

const noView = atom<PairView | null>(null);

/** The active pairs, kept read while the caller shows. */
export function usePairs(): PairInfo[] {
    const pairs = useAtomValue(pairListAtom);
    useEffect(() => {
        void ensurePairs();
    }, []);
    return pairs;
}

/** The resting judges, kept read while the caller shows (they come with the active pairs' list). */
export function useRestingJudges(): PairResting[] {
    const resting = useAtomValue(restingJudgesAtom);
    useEffect(() => {
        void ensurePairs();
    }, []);
    return resting;
}

/** The pair a tab is in, as the working agent or as a judge, with its role; null when it is in none. */
export function usePairOf(tabId: string | null): ReturnType<typeof pairOf> {
    const pairs = usePairs();
    return useMemo(() => pairOf(pairs, tabId), [pairs, tabId]);
}

/** A project's pairs in every state ("" is every project), kept read while the caller shows: null before the first read,
 *  and read again on every `pair:update`. */
export function usePairHistory(project: string): PairInfo[] | null {
    const pairs = useAtomValue(pairHistoryAtom(project));
    useEffect(() => {
        void loadPairHistory(project);
    }, [project]);
    return pairs;
}

/** One pair in full, kept read while the caller shows; a null id reads nothing. */
export function usePairView(pairId: string | null): PairView | null {
    const view = useAtomValue(pairId != null ? pairViewAtom(pairId) : noView);
    useEffect(() => {
        if (pairId != null) {
            void loadPair(pairId);
        }
    }, [pairId]);
    return view;
}

// ---- what the person has seen ----

const SEEN_KEY = "agent.pairseen";

// the browser's store, or none where the page has no localStorage (a test's node; a hardened profile throws on the read)
function seenStore(): Storage | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

function readSeen(): Record<string, number> {
    try {
        const raw = seenStore()?.getItem(SEEN_KEY);
        return raw == null ? {} : parseSeen(JSON.parse(raw));
    } catch (err) {
        // what it held was not JSON, or the read threw: nothing seen yet
        console.warn("reading what pairs were seen failed", err);
        return {};
    }
}

function writeSeen(seen: Record<string, number>): void {
    try {
        seenStore()?.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch (err) {
        console.warn("remembering what pairs were seen failed", err);
    }
}

const seenAtom = atom<Record<string, number>>(readSeen()) as PrimitiveAtom<Record<string, number>>;

/** How many messages of a pair the person last saw: 0 for a pair they never opened. Written, it is kept in localStorage. */
export const pairSeenAtom = atomFamily((pairId: string) =>
    atom(
        (get) => get(seenAtom)[pairId] ?? 0,
        (get, set, count: number) => {
            const seen = get(seenAtom);
            if ((seen[pairId] ?? 0) === count) {
                return;
            }
            const next = { ...seen, [pairId]: count };
            set(seenAtom, next);
            writeSeen(next);
        }
    )
);

/** The person has the conversation in front of them: every message it holds so far counts as seen. A pair nothing has been
 *  read of yet leaves the count as it was. */
export function markPairSeen(pairId: string): void {
    const count =
        globalStore.get(pairViewAtom(pairId))?.messages?.length ??
        globalStore.get(pairListAtom).find((p) => p.id === pairId)?.messagecount;
    if (count != null) {
        globalStore.set(pairSeenAtom(pairId), count);
    }
}
