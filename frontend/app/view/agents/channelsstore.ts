// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import * as WOS from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { knownRunVersions, mergeRunChanges } from "./channelruns";

export const channelsAtom = atom<Channel[] | null>(null) as PrimitiveAtom<Channel[] | null>;
// true = the last channel load failed (so an empty list reads as an error, not "no channels yet").
export const channelsErrorAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
export const activeChannelIdAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;

export const activeChannelAtom: Atom<Channel | null> = atom((get) => {
    const id = get(activeChannelIdAtom);
    if (!id) {
        return null;
    }
    return get(WOS.getWaveObjectAtom<Channel>(WOS.makeORef("channel", id))) ?? null;
});

// each channel's newest messages, keyed by channel id, for the readers that cross channels (the cockpit's
// needs-you count, a record's fleet). Filled with the channel snapshot, so it is exactly as fresh as that.
export const channelMessagesAtom = atom<Record<string, ChannelMessage[]>>({}) as PrimitiveAtom<
    Record<string, ChannelMessage[]>
>;

// Row-backed streams for the ACTIVE channel: seeded from the per-channel row RPCs and refreshed on every
// channel: object bump. Every message and run mutation bumps the channel's version, and that bump is the
// only signal that a list changed. It does not say which run, so the runs are refreshed by difference: a
// bump costs the rows that changed, not the channel's whole history.
export const activeChannelRunsAtom = atom<Run[]>([]) as PrimitiveAtom<Run[]>;
export const activeChannelMessagesAtom = atom<ChannelMessage[]>([]) as PrimitiveAtom<ChannelMessage[]>;

// the channel activeChannelRunsAtom was last filled for: one channel's versions are never sent for another
let runsChannelId: string | undefined;
// refreshes run one at a time, so each diffs against the list the one before it left
let streamsLoad: Promise<void> = Promise.resolve();

export function loadActiveChannelStreams(channelId: string): Promise<void> {
    const load = streamsLoad.then(() => refreshActiveChannelStreams(channelId));
    streamsLoad = load.catch(() => {});
    return load;
}

async function refreshActiveChannelStreams(channelId: string): Promise<void> {
    const held = runsChannelId === channelId ? globalStore.get(activeChannelRunsAtom) : [];
    const [runsRtn, msgsRtn] = await Promise.all([
        RpcApi.GetChannelRunChangesCommand(TabRpcClient, { channelid: channelId, known: knownRunVersions(held) }),
        RpcApi.GetChannelMessagesCommand(TabRpcClient, { channelid: channelId }),
    ]);
    // the user moved to another channel while this was in flight; that channel's own load fills the lists
    if (globalStore.get(activeChannelIdAtom) !== channelId) {
        return;
    }
    runsChannelId = channelId;
    globalStore.set(activeChannelRunsAtom, mergeRunChanges(held, runsRtn.runids ?? [], runsRtn.runs ?? []));
    globalStore.set(activeChannelMessagesAtom, msgsRtn.messages ?? []);
}

// per-run live subscription (RunBody reads this for the focused run's phase deltas via the run: WOS object)
export function runAtom(runId: string) {
    return WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", runId));
}

let loading = false;

// one fetch per channel, no limit: the server's newest-messages window, the same one the active channel's
// list has. A channel whose fetch fails keeps its previous list, so one failure does not blank the others.
async function fetchChannelMessagesInto(list: Channel[]): Promise<void> {
    const prev = globalStore.get(channelMessagesAtom);
    const entries = await Promise.all(
        list.map(async (c): Promise<[string, ChannelMessage[]]> => {
            try {
                const rtn = await RpcApi.GetChannelMessagesCommand(TabRpcClient, { channelid: c.oid });
                return [c.oid, rtn.messages ?? []];
            } catch (err) {
                console.error(`loading messages for channel ${c.oid} failed`, err);
                return [c.oid, prev[c.oid] ?? []];
            }
        })
    );
    globalStore.set(channelMessagesAtom, Object.fromEntries(entries));
}

// fetch the channel list and each channel's messages into the snapshot atoms (channels sorted
// newest-first). shared by loadChannels (which then auto-selects) and primeChannels (which must not select).
async function fetchChannelsInto(): Promise<Channel[]> {
    const rtn = await RpcApi.GetChannelsCommand(TabRpcClient);
    const list = (rtn.channels ?? []).sort((a, b) => b.createdts - a.createdts);
    globalStore.set(channelsAtom, list);
    await fetchChannelMessagesInto(list);
    return list;
}

export async function loadChannels(): Promise<void> {
    if (loading) {
        return;
    }
    loading = true;
    try {
        const list = await fetchChannelsInto();
        globalStore.set(channelsErrorAtom, false);
        const cur = globalStore.get(activeChannelIdAtom);
        if (!cur && list.length > 0) {
            await selectChannel(list[0].oid);
        }
    } catch (err) {
        console.error("loading channels failed", err);
        // distinct error state instead of an empty list that reads as "no channels"; keep last-good.
        globalStore.set(channelsErrorAtom, true);
        globalStore.set(channelsAtom, (prev) => prev ?? []);
    } finally {
        loading = false;
    }
}

// prime the channel snapshot at boot so the nav-rail badge + Cockpit "need you" counters dedup against
// Jarvis-answered asks before the Channels surface is ever opened. deliberately does NOT auto-select a
// channel (selection belongs to entering the surface, and would prematurely stamp read-ts).
export async function primeChannels(): Promise<void> {
    try {
        await fetchChannelsInto();
    } catch (err) {
        console.error("priming channels failed", err);
    }
}

export async function selectChannel(channelId: string): Promise<void> {
    await WOS.loadAndPinWaveObject<Channel>(WOS.makeORef("channel", channelId));
    globalStore.set(activeChannelIdAtom, channelId);
    // seed the row-backed streams for the newly-active channel (the bump-subscription below keeps them fresh)
    await loadActiveChannelStreams(channelId);
    // stamp last-read so the rail unread badge clears (fire-and-forget; failure is non-fatal)
    RpcApi.SetChannelReadCommand(TabRpcClient, { channelid: channelId, ts: Date.now() }).catch(() => {});
}

export async function createChannel(name: string, projectPath: string): Promise<string> {
    const ch = await RpcApi.CreateChannelCommand(TabRpcClient, { name, projectpath: projectPath });
    // not loadChannels: it drops the call while a load is in flight, and that load predates this channel
    await fetchChannelsInto();
    await selectChannel(ch.oid);
    return ch.oid;
}

// Persist autonomy tiers, then refresh the snapshot-fed rail so its badge updates immediately. The rail
// reads the channelsAtom snapshot (not live WOS), so a tier change is invisible until loadChannels()
// re-fetches — mirrors how create/delete already refresh. One refresh for the batch, not one per channel:
// the autonomy control writes every project at once.
export async function setChannelTiers(changes: { channelId: string; tier: string }[]): Promise<void> {
    await Promise.all(
        changes.map((c) =>
            RpcApi.SetChannelTierCommand(TabRpcClient, { channelid: c.channelId, tier: c.tier })
        )
    );
    await loadChannels();
}

// Ephemeral live consult streams, keyed `${consultId}:${runtime}`. Not persisted — superseded by the
// consult-reply message (matched by RefORef `consult:<consultId>` + author) once it arrives via WOS.
export interface ConsultStream {
    text: string;
    status: "streaming" | "done" | "error";
}
export const consultStreamsAtom = atom<Record<string, ConsultStream>>({}) as PrimitiveAtom<
    Record<string, ConsultStream>
>;

export function consultStreamKey(consultId: string, runtime: string): string {
    return `${consultId}:${runtime}`;
}

export function setConsultStream(consultId: string, runtime: string, stream: ConsultStream): void {
    const key = consultStreamKey(consultId, runtime);
    globalStore.set(consultStreamsAtom, { ...globalStore.get(consultStreamsAtom), [key]: stream });
}

// Refresh the row-backed streams whenever the pinned channel object bumps: the server bumps channel: on
// every message/run mutation, and nothing else says a list changed. Keyed on oid:version so it fires both
// when the active channel changes and when it mutates in place, and never loops (the loader sets only the
// runs/messages atoms, not the channel WOS object).
let lastLoadedChannelKey = "";
globalStore.sub(activeChannelAtom, () => {
    const ch = globalStore.get(activeChannelAtom);
    if (!ch) {
        lastLoadedChannelKey = "";
        return;
    }
    const key = `${ch.oid}:${ch.version}`;
    if (key === lastLoadedChannelKey) {
        return;
    }
    lastLoadedChannelKey = key;
    loadActiveChannelStreams(ch.oid).catch(() => {});
});