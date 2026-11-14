// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The initiative band's two stores (docs/superpowers/specs/2026-11-14-chat-initiative-link-design.md): which part of each
// agent's band is expanded (`chat.initiative.band` in localStorage, so a reload keeps them; the initiative part, or the
// brainstorm part beside it, one at a time), and the chunk switch, whose ops initiativeband.ts plans and which this file
// only sends. Module-level atoms, as every surface but Agent unmounts on a switch.

import { globalStore } from "@/app/store/jotaiStore";
import { effortDetailAtom, loadEffortDetail, mutateEffortOps } from "@/app/view/jarvis/effortstore";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { SWITCH_NOTE } from "./chatinitiative";
import { holdSwitchLine, queueSwitchLine } from "./chatinitiativestore";
import { chatBoxText, submitIntoChatBox } from "./chatinsert";
import { switchPlan } from "./initiativeband";

export const BAND_STORAGE_KEY = "chat.initiative.band";

// the agents whose band has a part expanded, kept to the newest this many
const MAX_OPEN = 200;

declare global {
    interface Window {
        // DEV: a string makes a chunk switch's second write fail with it before it is sent, so a CDP scenario can
        // see the rollback; the rollback itself runs for real
        __initiativeSwitchFail?: string;
    }
}

// a storage that throws (a private window, a restricted webview) degrades to a band that forgets; said once
let warned = false;
function warnOnce(what: string, e: unknown): void {
    if (!warned) {
        warned = true;
        console.warn(`[chat] initiative band state not ${what}:`, e instanceof Error ? e.message : String(e));
    }
}

/** The band's two parts: the initiative part and the brainstorm part (the brainstorm status beside it). One part is
 *  expanded at a time per agent. */
export type BandPart = "initiative" | "brainstorm";

/** One agent's expanded part. */
export type BandPartEntry = { id: string; part: BandPart };

const isBandPart = (v: unknown): v is BandPart => v === "initiative" || v === "brainstorm";

/** Pure: the expanded parts out of what localStorage held: a JSON list of `{ id, part }`, kept in order, the first of an
 *  agent's repeats winning, without empty ids or unknown parts, and cut to the newest 200. A bare string entry, the shape
 *  that landed first (a list of ids), reads as the initiative part, so a band open before the update stays open; anything
 *  else is none. */
export function coerceBandOpen(raw: unknown): BandPartEntry[] {
    if (typeof raw !== "string") {
        return [];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    const out: BandPartEntry[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
        let entry: BandPartEntry | null = null;
        if (typeof item === "string") {
            entry = { id: item, part: "initiative" };
        } else if (item != null && typeof item === "object" && !Array.isArray(item)) {
            const { id, part } = item as { id?: unknown; part?: unknown };
            if (typeof id === "string" && isBandPart(part)) {
                entry = { id, part };
            }
        }
        if (entry == null || entry.id === "" || seen.has(entry.id)) {
            continue;
        }
        seen.add(entry.id);
        out.push(entry);
    }
    return out.slice(-MAX_OPEN);
}

/** Pure: `list` with `agentId`'s expanded part set to `part` (as the newest, the oldest dropped past 200) or, with null,
 *  collapsed. The same list when it already is as asked. */
export function withBandPart(
    list: readonly BandPartEntry[],
    agentId: string,
    part: BandPart | null
): readonly BandPartEntry[] {
    if (part == null) {
        return list.some((e) => e.id === agentId) ? list.filter((e) => e.id !== agentId) : list;
    }
    const last = list[list.length - 1];
    if (last != null && last.id === agentId && last.part === part) {
        return list;
    }
    return [...list.filter((e) => e.id !== agentId), { id: agentId, part }].slice(-MAX_OPEN);
}

function readOpen(): BandPartEntry[] {
    try {
        return coerceBandOpen(globalThis.localStorage?.getItem(BAND_STORAGE_KEY));
    } catch (e) {
        warnOnce("read", e);
        return [];
    }
}

/** Each agent's expanded band part, oldest first; an agent not in the list has its band collapsed. Seeded from
 *  localStorage at module load. */
export const bandPartsAtom = atom<readonly BandPartEntry[]>(readOpen()) as PrimitiveAtom<readonly BandPartEntry[]>;

const partOf = atomFamily((agentId: string) =>
    atom((get) => get(bandPartsAtom).find((e) => e.id === agentId)?.part ?? null)
);

/** Which part of the agent's band is expanded, or null when it is collapsed (it starts collapsed). */
export function useBandPart(agentId: string): BandPart | null {
    return useAtomValue(partOf(agentId));
}

/** Expands one agent's `part` (replacing the other part if that one was open) or, with null, collapses its band; the
 *  other agents are untouched. A storage that cannot be written leaves it in memory. */
export function setBandPart(agentId: string, part: BandPart | null): void {
    const prev = globalStore.get(bandPartsAtom);
    const next = withBandPart(prev, agentId, part);
    if (next === prev) {
        return;
    }
    globalStore.set(bandPartsAtom, next);
    try {
        globalThis.localStorage?.setItem(BAND_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
        warnOnce("saved", e);
    }
}

/** Expands `part`, or collapses the band when `part` is the one already expanded. */
export function toggleBandPart(agentId: string, part: BandPart): void {
    const open = globalStore.get(bandPartsAtom).find((e) => e.id === agentId)?.part ?? null;
    setBandPart(agentId, open === part ? null : part);
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Moves the agent in tab `tabId` to the chunk `toLabel` of the initiative `oref` (decisions 5 and 11 of the plan). Two
 *  writes, since a batch validates against the state before any of its ops: the detach from the old chunk, then the attach
 *  to the chosen one. When the attach fails the old chunk is put back (the rollback) and this rejects with the attach's
 *  error, with the rollback's too when it failed as well; no line is queued. On success the switched line waits for the
 *  agent's next message. The initiative is read first when it is not loaded. A refusal rejects with wavesrv's message, for
 *  the band to show; nothing is swallowed. */
export async function switchAgentChunk(oref: string, tabId: string, toLabel: string): Promise<boolean> {
    if (globalStore.get(effortDetailAtom).get(oref) == null) {
        await loadEffortDetail(oref);
    }
    const effort = globalStore.get(effortDetailAtom).get(oref);
    if (effort == null) {
        throw new Error("This initiative could not be read");
    }
    const plan = switchPlan(effort, tabId, toLabel);
    if (plan.attach.length === 0) {
        return false; // the agent is on it already
    }
    if (plan.detach != null) {
        await mutateEffortOps(oref, plan.detach);
    }
    try {
        const fail = import.meta.env.DEV && typeof window !== "undefined" ? window.__initiativeSwitchFail : undefined;
        if (fail != null) {
            throw new Error(fail);
        }
        await mutateEffortOps(oref, plan.attach);
    } catch (e) {
        const message = messageOf(e);
        if (plan.rollback != null) {
            try {
                await mutateEffortOps(oref, plan.rollback);
            } catch (r) {
                throw new Error(`${message}; and the old chunk could not be restored: ${messageOf(r)}`);
            }
        }
        throw new Error(message);
    }
    queueSwitchLine(tabId, plan.line);
    return true;
}

/** The band's Switch to this chunk: moves the agent and tells it at once, its switched line going in front of SWITCH_NOTE
 *  through the chat box's own send (the wait behind a prompt, the scroll), when the agent is awake and its box is empty.
 *  A draft in the box (the line then goes with it), an asleep agent or no box leave the line waiting for the person's next
 *  message, as before. The waiting line is held back meanwhile, so it never flashes on the path that sends. */
export async function switchAndTell(oref: string, agentId: string, toLabel: string, awake: boolean): Promise<void> {
    holdSwitchLine(agentId, true);
    let sent = false;
    try {
        const switched = await switchAgentChunk(oref, agentId, toLabel);
        // the box lets the hold go itself once it tried the send (chatcomposer.tsx)
        sent = switched && awake && chatBoxText(agentId).trim() === "" && submitIntoChatBox(agentId, SWITCH_NOTE);
    } finally {
        if (!sent) {
            holdSwitchLine(agentId, false);
        }
    }
}

// ---- the band's how-to (the 3 steps over its rows) ----

export const BAND_HINT_KEY = "chat.initiative.hintSeen";

function readHintSeen(): boolean {
    try {
        return localStorage.getItem(BAND_HINT_KEY) === "1";
    } catch (e) {
        warnOnce("read", e);
        return false;
    }
}

// shown until the person presses Got it once (kept for the whole app, not per agent); ? on the band's line shows it again
const bandHintAtom = atom<boolean>(!readHintSeen()) as PrimitiveAtom<boolean>;

/** Whether the band's how-to shows over its rows. */
export function useBandHint(): boolean {
    return useAtomValue(bandHintAtom);
}

/** Got it: hides the how-to, and every band after it starts without one. */
export function dismissBandHint(): void {
    globalStore.set(bandHintAtom, false);
    try {
        localStorage.setItem(BAND_HINT_KEY, "1");
    } catch (e) {
        warnOnce("saved", e);
    }
}

/** The band line's ?: shows the how-to again (Got it hides it again). */
export function showBandHint(): void {
    globalStore.set(bandHintAtom, true);
}
