// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Doc review view's reads: the file under review, the "before" it diffs against, and a note's images.
//
// A review's file is read once per ask. The first load picks the baseline from what the previous review of the
// file showed, then records what this one is about to show, so a second load would diff the file against itself:
// the result is kept per agent, keyed by askId, and a remount or re-render reuses it. A load that lands after the
// agent asked again is dropped. Recording at load, not at send, keeps the next round's baseline right whichever
// surface answers.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { ensureSessionStart } from "./agentsessionstore";
import { pickBaseline, type BaselineFrom } from "./docbaseline";
import { getDocReview, recordShown, shownContentAtom } from "./docreviewstore";

export interface DocReviewLoad {
    askId: string;
    path: string;
    current: string | null; // null: the file could not be read
    baseline: string;
    from: BaselineFrom;
    ref: string; // the session start ref, shortened, when from is "session"
    reviewedAt?: number;
    round: number; // 1 for a file's first review this session
}

export const docReviewLoadAtom = atomFamily(
    (_agentId: string) => atom<DocReviewLoad | null>(null) as PrimitiveAtom<DocReviewLoad | null>
);

const inflight = new Map<string, Promise<DocReviewLoad | null>>();
// agent + path → reviews shown this session, for the round-2 eyebrow
const rounds = new Map<string, number>();

function splitPath(path: string): { dir: string; base: string } {
    const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return { dir: cut > 0 ? path.slice(0, cut) : path, base: path.slice(cut + 1) };
}

const shortRef = (ref: string) => (/^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 8) : ref);

// null when the file is gone: wavesrv answers a missing file with notfound rather than an error
async function readText(path: string): Promise<string | null> {
    try {
        const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path } });
        if (data == null || data.info?.notfound || data.info?.isdir) {
            return null;
        }
        return base64ToString(data.data64 ?? "");
    } catch {
        return null;
    }
}

// the file at a ref, read from its own folder (FileAtRef resolves `ref:./path` against cwd); null: outside a repo,
// or not readable as text. A missing blob is "" only when asked: at the session ref it means the file was made
// this session, at HEAD that the file is new.
async function readAtRef(dir: string, base: string, ref: string, missingAsEmpty: boolean): Promise<string | null> {
    try {
        const r = await RpcApi.GitFileAtRefCommand(TabRpcClient, { cwd: dir, ref, path: base });
        if (!r?.isrepo || r.binary || r.toolarge) {
            return null;
        }
        if (r.missing) {
            return missingAsEmpty ? "" : null;
        }
        return r.content ?? "";
    } catch {
        return null;
    }
}

// the session's start ref and the file at it; null text with no transcript, no start time or no repo
async function readAtSession(
    dir: string,
    base: string,
    transcriptPath: string | undefined
): Promise<{ text: string | null; ref: string }> {
    const ts = await ensureSessionStart(transcriptPath);
    if (ts == null) {
        return { text: null, ref: "" };
    }
    try {
        const ch = await RpcApi.GitChangesCommand(TabRpcClient, { cwd: dir, sessionstartts: ts });
        if (!ch?.isrepo || !ch.ref) {
            return { text: null, ref: "" };
        }
        return { text: await readAtRef(dir, base, ch.ref, true), ref: shortRef(ch.ref) };
    } catch {
        return { text: null, ref: "" };
    }
}

export function loadDocReview(
    agentId: string,
    input: { askId: string; path: string; transcriptPath?: string },
    now = Date.now()
): Promise<DocReviewLoad | null> {
    const kept = globalStore.get(docReviewLoadAtom(agentId));
    if (kept?.askId === input.askId) {
        return Promise.resolve(kept);
    }
    const key = `${agentId}\u0000${input.askId}`;
    const running = inflight.get(key);
    if (running != null) {
        return running;
    }
    const p = runLoad(agentId, input, now).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
}

async function runLoad(
    agentId: string,
    { askId, path, transcriptPath }: { askId: string; path: string; transcriptPath?: string },
    now: number
): Promise<DocReviewLoad | null> {
    // the previous record, read before this load records over it
    const shown = globalStore.get(shownContentAtom(agentId))[path];
    const { dir, base } = splitPath(path);
    const current = await readText(path);
    let picked = pickBaseline({ shown });
    let ref = "";
    if (current != null && shown == null) {
        const session = await readAtSession(dir, base, transcriptPath);
        ref = session.ref;
        const atHead = session.text == null ? await readAtRef(dir, base, "HEAD", false) : null;
        picked = pickBaseline({ atSession: session.text, atHead });
    }
    // the agent asked again (or its ask cleared) while this read: it would land on the wrong review
    if (getDocReview(agentId)?.askId !== askId) {
        return null;
    }
    const roundKey = `${agentId}\u0000${path}`;
    const round = shown == null ? 1 : (rounds.get(roundKey) ?? 1) + 1;
    if (current != null) {
        recordShown(agentId, path, current, now);
        rounds.set(roundKey, round);
    }
    const load: DocReviewLoad = { askId, path, current, baseline: picked.text, from: picked.from, ref, round };
    if (picked.reviewedAt != null) {
        load.reviewedAt = picked.reviewedAt;
    }
    globalStore.set(docReviewLoadAtom(agentId), load);
    return load;
}

// ---------------------------------------------------------------------------------------------------------------
// images

// The app's CSP allows `img-src 'self' data:`, so an <img> pointing at wavesrv is blocked: a note's image is read
// over RPC and drawn as a data URL, up to this size. Past it, or for a type a data URL can't carry, the view shows
// the alt text and the path.
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const MIME: Record<string, string> = {
    png: "image/png",
    svg: "image/svg+xml",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
};

export function imageMime(path: string): string | null {
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
    return (ext && MIME[ext]) || null;
}

export type ImageData = { ok: true; url: string } | { ok: false; why: "type" | "read" | "size" };

const images = new Map<string, Promise<ImageData>>();

// one read per path for the session; the view draws the same figure on every render
export function loadImage(path: string): Promise<ImageData> {
    let p = images.get(path);
    if (p == null) {
        p = readImage(path);
        images.set(path, p);
    }
    return p;
}

async function readImage(path: string): Promise<ImageData> {
    const mime = imageMime(path);
    if (mime == null) {
        return { ok: false, why: "type" };
    }
    try {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } });
        if (info == null || info.notfound || info.isdir) {
            return { ok: false, why: "read" };
        }
        if ((info.size ?? 0) > IMAGE_MAX_BYTES) {
            return { ok: false, why: "size" };
        }
        const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path } });
        if (!data?.data64) {
            return { ok: false, why: "read" };
        }
        return { ok: true, url: `data:${mime};base64,${data.data64}` };
    } catch {
        return { ok: false, why: "read" };
    }
}
