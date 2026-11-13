// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The reply a Claude agent is writing, in Chat, the state half (chatlive.ts is the pure half): one
// StreamAgentLiveReplyCommand per Chat pane on screen, which sends the arc mod's live reply file each time it changes,
// held in one atom per stream id. A reply that stops being fresh (chatlive.ts liveFresh: done and lingered, or stood
// still) is cleared by a timer, so a session that never lands a block leaves nothing behind. Like livetranscript.ts,
// stopping the stream cancels the generator, which ends the watch in wavesrv; a websocket reconnect re-opens them all.

import { globalStore } from "@/app/store/jotaiStore";
import { addWSReconnectHandler, removeWSReconnectHandler } from "@/app/store/ws";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { liveExpiresAt, liveFresh, parseLiveReply, type LiveReply } from "./chatlive";

// livetranscript.ts STREAM_TIMEOUT_MS: the stream stays open while the pane is on screen, however quiet
const STREAM_TIMEOUT_MS = 31536000000;

const replyAtoms = new Map<string, PrimitiveAtom<LiveReply | null>>();

/** The live reply of the stream `id`, null when there is none worth drawing. */
export function liveReplyAtom(id: string): PrimitiveAtom<LiveReply | null> {
    let a = replyAtoms.get(id);
    if (a == null) {
        a = atom<LiveReply | null>(null) as PrimitiveAtom<LiveReply | null>;
        replyAtoms.set(id, a);
    }
    return a;
}

interface Stream {
    path: string;
    stop: () => void;
    timer: number | undefined;
}
const streams = new Map<string, Stream>();

// shows the reply while it is fresh, and clears it once it is not
function show(id: string, s: Stream, reply: LiveReply | null): void {
    window.clearTimeout(s.timer);
    s.timer = undefined;
    const now = Date.now();
    if (reply == null || !liveFresh(reply, now)) {
        globalStore.set(liveReplyAtom(id), null);
        return;
    }
    globalStore.set(liveReplyAtom(id), reply);
    s.timer = window.setTimeout(() => show(id, s, null), Math.max(0, liveExpiresAt(reply) - now));
}

/** Opens the live reply stream of the session whose transcript is at `path`, under `id`; a second call for one id
 *  does nothing. */
export function startLiveReplyStream(id: string, path: string): void {
    if (!path || streams.has(id)) {
        return;
    }
    const gen = RpcApi.StreamAgentLiveReplyCommand(TabRpcClient, { path }, { timeout: STREAM_TIMEOUT_MS });
    let cancelled = false;
    const s: Stream = {
        path,
        timer: undefined,
        stop: () => {
            cancelled = true;
            void gen.return?.(undefined);
        },
    };
    streams.set(id, s);
    void (async () => {
        try {
            for await (const update of gen) {
                if (cancelled) {
                    break;
                }
                show(id, s, parseLiveReply(update?.text ?? ""));
            }
        } catch {
            // the stream ended (no such transcript path, a dropped socket): the reply stays until its timer clears it
        } finally {
            if (streams.get(id) === s) {
                streams.delete(id);
            }
        }
    })();
}

/** Closes the stream `id` and clears its reply. */
export function stopLiveReplyStream(id: string): void {
    const s = streams.get(id);
    if (s != null) {
        s.stop();
        window.clearTimeout(s.timer);
        streams.delete(id);
    }
    // the atom stays (one per pane a session was seen in): a pane still subscribed to it then reads null, not a stale one
    if (replyAtoms.has(id)) {
        globalStore.set(liveReplyAtom(id), null);
    }
}

// a reconnect leaves the old generators hung (livetranscript.ts restartActiveStreams): re-open each, keeping its reply
function restartLiveReplyStreams(): void {
    const active = [...streams.entries()].map(([id, s]) => ({ id, path: s.path, s }));
    for (const { id, s } of active) {
        s.stop();
        window.clearTimeout(s.timer);
        streams.delete(id);
    }
    for (const { id, path } of active) {
        startLiveReplyStream(id, path);
    }
}

addWSReconnectHandler(restartLiveReplyStreams);
if (import.meta.hot) {
    import.meta.hot.dispose(() => removeWSReconnectHandler(restartLiveReplyStreams));
}
