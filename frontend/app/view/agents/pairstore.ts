// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pairs (pkg/agentpair), as the Agent surface reads them: one list atom of the active pairs and one view atom per
// pair, read over wshrpc on first use and again whenever wavesrv says a pair changed (`pair:update`, published after every
// change). What outlives a view is here too: which message the conversation scrolls to, and how many messages of each
// pair the person has seen (the header button's "N new"). Pure rules are in pairmodel.ts.
//
// The dev mock (devMockPairsAtom) is how a CDP scenario seeds pairs with no agent running: while it is set it replaces the
// server's answer whole, as devmock.ts's devMockAgentsAtom does the roster, and nothing is read from wavesrv.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue, type Atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { useEffect, useMemo } from "react";
import { pairOf, parseSeen } from "./pairmodel";

// cast because a null initial value picks jotai's read-only overload under the non-strict tsconfig

/** null = no mock: the server's pairs. A non-null array (INCLUDING []) replaces them whole. */
export const devMockPairsAtom = atom<PairView[] | null>(null) as PrimitiveAtom<PairView[] | null>;

const serverPairsAtom = atom<PairInfo[] | null>(null) as PrimitiveAtom<PairInfo[] | null>;
const serverViewAtom = atomFamily((_id: string) => atom<PairView | null>(null) as PrimitiveAtom<PairView | null>);

/** The active pairs (not the ended ones), empty before the first read. A PairView carries its PairInfo, so a mocked view
 *  stands for its row. */
export const pairListAtom: Atom<PairInfo[]> = atom((get) => get(devMockPairsAtom) ?? get(serverPairsAtom) ?? []);

/** One pair in full by id, or null before it is read (or when the mock holds no such pair). */
export const pairViewAtom = atomFamily(
    (id: string): Atom<PairView | null> =>
        atom((get) => {
            const mock = get(devMockPairsAtom);
            return mock != null ? (mock.find((v) => v.id === id) ?? null) : get(serverViewAtom(id));
        })
);

/** The message the conversation scrolls to and clears: an agreed item's link sets it. */
export const pairScrollToAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// ---- loading ----

const mocked = () => globalStore.get(devMockPairsAtom) != null;

// what has been read: an event only reads those again (atomFamily cannot be enumerated)
const knownPairs = new Set<string>();
// a read that an event overtakes must not be overwritten by the earlier read's late answer
const viewSeq = new Map<string, number>();
let listSeq = 0;
let firstList: Promise<void> | null = null;

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
            // the pair it names, or every pair read when it names none
            for (const id of data != null ? [data.pairid] : knownPairs) {
                if (knownPairs.has(id)) {
                    void loadPair(id);
                }
            }
        },
    });
}

/** Reads the active pairs into the list atom. A failure leaves the list as it was and logs. */
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

/** Reads one pair in full into its atom. A failure leaves the atom as it was and logs. */
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
        }
    } catch (err) {
        console.error(`loading pair ${id} failed`, err);
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

/** The pair a tab is in, as the working agent or as a judge, with its role; null when it is in none. */
export function usePairOf(tabId: string | null): ReturnType<typeof pairOf> {
    const pairs = usePairs();
    return useMemo(() => pairOf(pairs, tabId), [pairs, tabId]);
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
