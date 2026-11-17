// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of the Sidecar bridge (sidecarbridge.tsx; spec 2026-11-13-sidecar-design.md, section 2): which acts the
// page may send, when two snapshots are the same, and when a snapshot goes out. The bridge keeps one FeedState and asks
// these functions what to do at each change, hello and close, so the throttle and the last-sent memory are tested here
// and not through a timer. Part 2 adds what the bridge needs to feed the strain band: how a machine reading becomes the
// snapshot's figures (rounded, so a poll does not re-emit), which polls the band needs, a heavy row's note, the notes
// Stop and Sleep leave, and the answer to an older act.

import type { SleepOutcome } from "@/app/view/agents/agentsleep";
import type { OlderPage } from "./sidecarhistory";
import { strainBy, type MachineReading, type StrainState } from "./sidecarstrainmodel";
import type {
    SidecarAct,
    SidecarHeavy,
    SidecarMachine,
    SidecarMessage,
    SidecarOlder,
    SidecarSnapshot,
    SidecarStrain,
    StrainLevel,
} from "./sidecartypes";

// At most one snapshot per this long (decision 1): a burst of store changes goes out as one trailing emit.
export const SNAPSHOT_THROTTLE_MS = 500;
/** The machine is read at hello and then this often while a page is live (decision 8), ms. */
export const MACHINE_POLL_MS = 5_000;
/** The per-agent CPU reading is read this often while a band measured by CPU shows (decision 10), ms. */
export const CPU_POLL_MS = 2_000;
/** A heavy-agent reading older than this names no one: the band shows no rows until a fresh one lands, ms. */
export const HEAVY_STALE_MS = 15_000;

export type ActCheck = { ok: true; act: SidecarAct } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

// How many rows one older act may ask for (decision 5: the page asks for 10).
const OLDER_MIN = 1;
const OLDER_MAX = 50;

/** The heavy row of the last snapshot's strain band that a stop or a sleep names; the page can only act on a row it was shown. */
function heavyRow(
    kind: "stop" | "sleep",
    raw: Record<string, unknown>,
    last: SidecarSnapshot | null
): { ok: true; heavy: SidecarHeavy } | { ok: false; reason: string } {
    if (typeof raw.id !== "string") {
        return { ok: false, reason: `${kind}: no id` };
    }
    if (last == null) {
        return { ok: false, reason: `${kind}: no snapshot has gone out yet` };
    }
    if (last.strain == null) {
        return { ok: false, reason: `${kind}: the last snapshot has no strain band` };
    }
    const heavy = last.strain.heavy.find((h) => h.id === raw.id);
    if (heavy == null) {
        return { ok: false, reason: `${kind}: no heavy row "${raw.id}" in the last snapshot` };
    }
    return { ok: true, heavy };
}

/**
 * An act from the page, checked against the last snapshot that went out (the page can only act on what it was shown).
 * The reason of a refusal is what the bridge logs. The act it returns carries only the fields of its kind.
 */
export function validateAct(raw: unknown, last: SidecarSnapshot | null): ActCheck {
    if (!isRecord(raw) || typeof raw.kind !== "string") {
        return { ok: false, reason: "not an act" };
    }
    switch (raw.kind) {
        case "hello":
            return { ok: true, act: { kind: "hello" } };
        case "open": {
            if (typeof raw.id !== "string") {
                return { ok: false, reason: "open: no id" };
            }
            if (last == null) {
                return { ok: false, reason: "open: no snapshot has gone out yet" };
            }
            if (!last.tiles.some((t) => t.id === raw.id)) {
                return { ok: false, reason: `open: no tile "${raw.id}" in the last snapshot` };
            }
            return { ok: true, act: { kind: "open", id: raw.id } };
        }
        case "answer": {
            if (typeof raw.id !== "string") {
                return { ok: false, reason: "answer: no id" };
            }
            if (last == null) {
                return { ok: false, reason: "answer: no snapshot has gone out yet" };
            }
            const tile = last.tiles.find((t) => t.id === raw.id);
            if (tile == null) {
                return { ok: false, reason: `answer: no tile "${raw.id}" in the last snapshot` };
            }
            if (tile.ask == null) {
                return { ok: false, reason: `answer: "${tile.id}" has no ask` };
            }
            if (!tile.ask.answerable) {
                return { ok: false, reason: `answer: the ask of "${tile.id}" is not answerable from a tile` };
            }
            const option = raw.option;
            if (
                typeof option !== "number" ||
                !Number.isInteger(option) ||
                option < 0 ||
                option >= tile.ask.options.length
            ) {
                return {
                    ok: false,
                    reason: `answer: option ${String(option)} is not one of the ${tile.ask.options.length} options of "${tile.id}"`,
                };
            }
            // the page names the ask it showed: a snapshot that brought a new ask since then must not take this answer
            if (typeof raw.key !== "string" || tile.ask.key == null || raw.key !== tile.ask.key) {
                return { ok: false, reason: `answer: the ask of "${tile.id}" changed since the page showed it` };
            }
            return { ok: true, act: { kind: "answer", id: tile.id, option, key: raw.key } };
        }
        case "older": {
            const id = raw.id;
            if (typeof id !== "string") {
                return { ok: false, reason: "older: no id" };
            }
            if (last == null) {
                return { ok: false, reason: "older: no snapshot has gone out yet" };
            }
            if (!last.tiles.some((t) => t.id === id)) {
                return { ok: false, reason: `older: no tile "${id}" in the last snapshot` };
            }
            const cursor = raw.before;
            let before: string | null;
            if (cursor === null) {
                before = null;
            } else if (typeof cursor === "string") {
                before = cursor;
            } else {
                return { ok: false, reason: `older: before ${String(cursor)} is neither a cursor nor null` };
            }
            const count = raw.count;
            if (typeof count !== "number" || !Number.isInteger(count) || count < OLDER_MIN || count > OLDER_MAX) {
                return {
                    ok: false,
                    reason: `older: count ${String(count)} is not a whole number from ${OLDER_MIN} to ${OLDER_MAX}`,
                };
            }
            return { ok: true, act: { kind: "older", id, before, count } };
        }
        case "stop": {
            const row = heavyRow("stop", raw, last);
            if (row.ok === false) {
                return row;
            }
            if (row.heavy.process == null) {
                return { ok: false, reason: `stop: "${row.heavy.id}" has no process to stop` };
            }
            if (raw.pid !== row.heavy.process.pid) {
                return {
                    ok: false,
                    reason: `stop: pid ${String(raw.pid)} is not the process of "${row.heavy.id}" in the band`,
                };
            }
            return { ok: true, act: { kind: "stop", id: row.heavy.id, pid: row.heavy.process.pid } };
        }
        case "sleep": {
            const row = heavyRow("sleep", raw, last);
            if (row.ok === false) {
                return row;
            }
            return { ok: true, act: { kind: "sleep", id: row.heavy.id } };
        }
        default:
            return { ok: false, reason: `unknown act kind "${raw.kind}"` };
    }
}

function same(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }
    if (Array.isArray(a)) {
        return Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
    }
    if (isRecord(a)) {
        if (!isRecord(b)) {
            return false;
        }
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of keys) {
            // an absent field and an undefined one are the same thing on the wire
            if (!same(a[k], b[k])) {
                return false;
            }
        }
        return true;
    }
    return false;
}

/**
 * Whether two snapshots say the same thing: everything but `now`, which moves on every build. Nothing sent is never the
 * same. The machine figures reach it already rounded (decision 8), so a reading that only jitters does not differ.
 */
export function sameSnapshot(a: SidecarSnapshot | null, b: SidecarSnapshot | null): boolean {
    if (a == null || b == null) {
        return false;
    }
    return same(a.counts, b.counts) && same(a.tiles, b.tiles) && same(a.machine, b.machine) && same(a.strain, b.strain);
}

/** What the bridge remembers of its feed: the snapshot the page last got, and when it went out. */
export interface FeedState {
    lastSent: SidecarSnapshot | null;
    lastEmitAt: number | null;
}

export const EMPTY_FEED: FeedState = { lastSent: null, lastEmitAt: null };

export type FeedStep =
    | { kind: "emit" } // send the snapshot just built, now
    | { kind: "later"; delayMs: number } // schedule the trailing emit; it builds a fresh snapshot when it fires
    | { kind: "none" }; // nothing changed, or a trailing emit is already scheduled and will carry this change

/**
 * What to do with `next` just built after a store change. `timerPending` is whether a trailing emit is already
 * scheduled: it will build its own snapshot, so this change coalesces into it.
 */
export function planChange(feed: FeedState, next: SidecarSnapshot, timerPending: boolean, now: number): FeedStep {
    if (sameSnapshot(feed.lastSent, next)) {
        return { kind: "none" };
    }
    if (timerPending) {
        return { kind: "none" };
    }
    if (feed.lastEmitAt == null) {
        return { kind: "emit" };
    }
    const wait = SNAPSHOT_THROTTLE_MS - (now - feed.lastEmitAt);
    return wait <= 0 ? { kind: "emit" } : { kind: "later", delayMs: wait };
}

/** The memory once `snap` has gone out. */
export function afterEmit(snap: SidecarSnapshot, now: number): FeedState {
    return { lastSent: snap, lastEmitAt: now };
}

/**
 * A hello forgets the snapshot last sent: a page that reloaded or reopened has none of it, so the answer must go out
 * even when the roster has not changed. The bridge emits at once after this, which sets the memory again.
 */
export function afterHello(feed: FeedState): FeedState {
    return { ...feed, lastSent: null };
}

/** sidecar:closed: the page is gone, so the next one starts from nothing. */
export function afterClosed(): FeedState {
    return EMPTY_FEED;
}

const MB = 2 ** 20;
const GB = 2 ** 30;
const TENTH_GB = GB / 10;

// to a tenth of a GiB, as whole bytes: the figure the title bar and the band print
function roundTenthGiB(n: number): number {
    return Math.round(Math.round(n / TENTH_GB) * TENTH_GB);
}

// a RAM figure as the band prints it (formatBytes: whole MB under half a GB, a tenth of a GB above), as whole bytes
function roundRam(n: number): number {
    return n < GB / 2 ? Math.round(n / MB) * MB : roundTenthGiB(n);
}

// a CPU share as a whole percent; a share above zero never reads 0%
function roundCpu(n: number): number {
    return n > 0 ? Math.max(1, Math.round(n)) : Math.round(n);
}

/**
 * The snapshot's machine figures from a machine reading (decision 8): memory free, total and swap used to a tenth of a
 * GiB, CPU to a whole percent, so a poll whose numbers only jitter gives the same figures and no new snapshot. `swapUsed`
 * is left out when nothing is in swap, `cpuPct` before the first CPU reading.
 */
export function machineOf(s: MachineStatsData, platform: SidecarMachine["platform"]): SidecarMachine {
    const swap = roundTenthGiB(s.swapused);
    return {
        memFree: roundTenthGiB(s.memavailable),
        memTotal: roundTenthGiB(s.memtotal),
        ...(swap > 0 ? { swapUsed: swap } : {}),
        ...(s.cpupct != null ? { cpuPct: Math.round(s.cpupct) } : {}),
        platform,
    };
}

/** The strain model's reading of a machine reading, taken at `at`. */
export function readingOf(s: MachineStatsData, at: number): MachineReading {
    return {
        at,
        pressure: s.pressure,
        memFree: s.memavailable,
        memTotal: s.memtotal,
        ...(s.cpupct != null ? { cpuPct: s.cpupct } : {}),
    };
}

/**
 * The last poll with a memorypressure event laid over it: the level and the memory move, everything else (the total, the
 * CPU, the swap) stays the last poll's. Read through `readingOf`, an event between two polls therefore carries the last
 * CPU, and does not restart the 120 s CPU streak (which a reading with no CPU does). Null before any poll: an event
 * alone has no total or CPU to carry, and the hello read answers the same level a moment later.
 */
export function applyPressure(
    s: MachineStatsData | null,
    e: { level?: unknown; memavailable?: unknown } | null | undefined
): MachineStatsData | null {
    if (s == null) {
        return null;
    }
    return {
        ...s,
        pressure: typeof e?.level === "string" ? e.level : s.pressure,
        memavailable:
            typeof e?.memavailable === "number" && Number.isFinite(e.memavailable) ? e.memavailable : s.memavailable,
    };
}

/** Which heavy-agent polls the band needs now (decision: neither runs while the band is down). RAM when RAM is up, else CPU. */
export function heavyPolls(state: StrainState | null): { consumers: boolean; cpu: boolean } {
    if (state == null) {
        return { consumers: false, cpu: false };
    }
    const by = strainBy(state);
    return { consumers: by === "ram", cpu: by === "cpu" };
}

/** Whether a heavy-agent reading that landed at `at` (null: never) can still name agents at `now`. */
export function readingFresh(at: number | null, now: number): boolean {
    return at != null && now - at <= HEAVY_STALE_MS;
}

/**
 * The heavy rows with their figures rounded as the band prints them (RAM like `formatBytes`, CPU to a whole percent), so
 * each poll that only jitters leaves the rows, and the snapshot, the same. Pure: the rows given are not touched.
 */
export function roundHeavy(rows: SidecarHeavy[]): SidecarHeavy[] {
    return rows.map((h) => ({
        ...h,
        ...(h.ramBytes != null ? { ramBytes: roundRam(h.ramBytes) } : {}),
        ...(h.cpuPct != null ? { cpuPct: roundCpu(h.cpuPct) } : {}),
        ...(h.process != null
            ? {
                  process: {
                      ...h.process,
                      ...(h.process.ramBytes != null ? { ramBytes: roundRam(h.process.ramBytes) } : {}),
                      ...(h.process.cpuPct != null ? { cpuPct: roundCpu(h.process.cpuPct) } : {}),
                  },
              }
            : {}),
    }));
}

/** The jobs the heavy-job queue is running now: the "heavy jobs running" of the band's second line. */
export function runningJobs(q: JobQueueData | null): number {
    return q == null ? 0 : q.jobs.filter((j) => j.running).length;
}

/** The snapshot's strain from the model's state, the counts and the heavy rows. The CPU percent goes out whole. */
export function strainOf(state: StrainState, working: number, heavyJobs: number, heavy: SidecarHeavy[]): SidecarStrain {
    return {
        level: state.level,
        by: strainBy(state),
        ...(state.ram != null ? { ram: state.ram } : {}),
        ...(state.cpu != null ? { cpu: { since: state.cpu.since, pct: Math.round(state.cpu.pct) } } : {}),
        working,
        heavyJobs,
        heavy,
    };
}

/**
 * The notes Stop and Sleep leave on the band's rows, by tile id, and the level they were left at: a note lasts until the
 * band's level changes or its agent leaves the band (decision 11).
 */
export interface HeavyNotes {
    level: StrainLevel | null;
    byId: Record<string, string>;
}

export const EMPTY_NOTES: HeavyNotes = { level: null, byId: {} };

/** The notes after the band was built at `level` with rows for `ids`: all gone when the level moved, else those of agents still in it. */
export function syncNotes(n: HeavyNotes, level: StrainLevel | null, ids: readonly string[]): HeavyNotes {
    if (n.level !== level) {
        return { level, byId: {} };
    }
    const keep = Object.entries(n.byId).filter(([id]) => ids.includes(id));
    return keep.length === Object.keys(n.byId).length ? n : { level, byId: Object.fromEntries(keep) };
}

/** `n` with `note` on the row of `id`, replacing the last one. */
export function setNote(n: HeavyNotes, id: string, note: string): HeavyNotes {
    return { ...n, byId: { ...n.byId, [id]: note } };
}

/** The rows with their notes; a row with none gets no `note` field. */
export function attachNotes(rows: SidecarHeavy[], byId: Record<string, string>): SidecarHeavy[] {
    return rows.map((h) => (byId[h.id] != null ? { ...h, note: byId[h.id] } : h));
}

/** What a Sleep from the band did, in the words of the row's note. */
export function sleepNote(outcome: SleepOutcome): string {
    switch (outcome) {
        case "slept":
            return "Put to sleep";
        case "compacting":
            return "Compacting first · it sleeps once the summary lands";
        case "asked":
            return "Confirm in the main window";
        case "failed":
            return "Couldn't put it to sleep · see the main window";
        case "busy":
            return "Already going to sleep";
    }
}

const NOTE_MAX_CHARS = 160;

/** The row's note after a Stop the server refused: its own text, cut to fit a row. */
export function stopNote(e: unknown): string {
    const text = (e instanceof Error ? e.message : String(e)).trim();
    if (text === "") {
        return "Couldn't stop it";
    }
    return text.length <= NOTE_MAX_CHARS ? text : text.slice(0, NOTE_MAX_CHARS - 1) + "…";
}

/** What an older act is answered from: the rows the main window holds for the agent, or its transcript file. */
export interface OlderInput {
    all: SidecarMessage[]; // the rows the main window holds, oldest first; empty for an agent with no entries in memory
    shown: SidecarMessage[]; // the rows the last snapshot sent for the tile
    path?: string; // its transcript file
    agent?: string; // its harness, which picks the transcript projector
}

/** The two readers `answerOlder` calls (sidecarhistory.ts's olderFromMemory and readOlderFromFile), passed in so the rule is tested without an RPC. */
export interface OlderReaders {
    memory: (all: SidecarMessage[], shownCount: number, before: string | null, count: number) => OlderPage;
    file: (
        path: string,
        agent: string | undefined,
        before: string | null,
        shown: SidecarMessage[]
    ) => Promise<OlderPage>;
}

/**
 * The answer to an older act (decision 5). An agent with entries in memory pages from them, one with none and a transcript
 * path from the file, any other has nothing earlier. Never rejects: a failed file read is logged through `onError` and
 * answered `rows: [], next: null`, which the page shows as the start of what arcterm holds and stops asking.
 */
export async function answerOlder(
    act: { id: string; before: string | null; count: number },
    input: OlderInput,
    readers: OlderReaders,
    onError: (message: string) => void
): Promise<SidecarOlder> {
    const answer = (page: OlderPage): SidecarOlder => ({
        id: act.id,
        before: act.before,
        rows: page.rows,
        next: page.next,
    });
    if (input.all.length > 0) {
        return answer(readers.memory(input.all, input.shown.length, act.before, act.count));
    }
    if (input.path != null && input.path !== "") {
        try {
            return answer(await readers.file(input.path, input.agent, act.before, input.shown));
        } catch (e) {
            onError(`older ${act.id}: the transcript read failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return answer({ rows: [], next: null });
}
