// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Builds the tray popover's TraySnapshot from the cockpit's own stores (spec 2026-10-15-tray-popover-design.md), and
// the icon's badge. The waits are the rows Sprout wears (petpeekmodel.ts queueRows), so the tray and Sprout never
// disagree about what waits on you. Pure: traybridge.tsx feeds it and sends the result.

import { usageLevel, type AgentVM } from "@/app/view/agents/agentsviewmodel";
import { formatResetShort, providerLabel, windowElapsed } from "@/app/view/agents/cockpitrailmodel";
import type { ProviderDonuts } from "@/app/view/agents/ratelimitstore";
import { CARD_COPY, CARD_ORDER } from "@/app/view/agents/storagemodel";
import { kindWord } from "@/app/view/jarvis/briefingmodel";
import type { PeekRow } from "@/app/view/jarvis/petpeekmodel";
import { openTargetFor, ordered, paceValue, pauseLeft, sourceLabel } from "./jobqueue";
import type { TrayLevel, TrayPlatform, TraySnapshot, TrayStorageRow } from "./traytypes";

const MAX_WAITS = 5;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const IN_PLACE = new Set(["runworktrees", "sessions", "housekeeping"]);

export interface TraySnapshotInput {
    platform: TrayPlatform;
    machine: MachineStatsData | null;
    jobQueue: JobQueueData | null;
    agents: readonly AgentVM[];
    peekRows: PeekRow[];
    donuts: ProviderDonuts[];
    storage: StorageReport | null;
    consumers: CommandGetConsumersRtnData | null;
    heardAt: number | null; // wavesrv's last answer to the bridge: the heartbeat, the machine poll or a memory-pressure event
    now: number;
}

function level(word: string | undefined): TrayLevel {
    return word === "normal" || word === "high" || word === "critical" ? word : "unknown";
}

function firstSentence(s: string): string {
    const i = s.indexOf(". ");
    return i < 0 ? s : s.slice(0, i + 1);
}

export function traySnapshot(i: TraySnapshotInput): TraySnapshot {
    const m = i.machine;
    const jobs = ordered(i.jobQueue?.jobs ?? []).map((j) => ({
        id: j.id,
        name: j.name,
        bytes: j.bytes,
        running: j.running === true,
        position: j.running ? null : (j.position ?? null),
        elapsedMs: i.now - (j.running ? (j.startedts ?? j.queuedts) : j.queuedts),
        source: sourceLabel(j, i.agents),
        // a running job has one too when it started past a paused queue
        reason: j.reason ?? "",
        engine: j.engine === true,
        canOpen: openTargetFor(j, i.agents) != null,
    }));
    const waits = i.peekRows.slice(0, MAX_WAITS).map((r) => ({
        key: r.key,
        kind: kindWord(r.kind),
        ask: r.kind === "ask" || r.kind === "escalation",
        title: r.detail ?? r.source,
        tail: r.detail != null ? r.source : "",
    }));
    const claude = i.donuts.find((d) => d.provider === "claude");
    const pct = claude?.fivehour.pct;
    const elapsed = claude == null ? undefined : windowElapsed(claude.fivehour.reset, FIVE_HOURS_MS, i.now);
    const usage =
        claude == null || pct == null
            ? null
            : {
                  pct,
                  elapsedPct: elapsed == null ? null : elapsed * 100, // windowElapsed is a 0-1 fraction
                  level: usageLevel(pct),
                  title:
                      "Claude's 5-hour window: " +
                      (claude.fivehour.reset
                          ? `resets in ${formatResetShort(claude.fivehour.reset, i.now)}`
                          : "no reset yet") +
                      (claude.week.pct != null ? ` · week ${Math.round(claude.week.pct)}%` : ""),
              };
    let storage: TraySnapshot["storage"] = null;
    if (i.storage != null && i.storage.scannedts > 0) {
        const cats = i.storage.categories ?? [];
        const rows: TrayStorageRow[] = CARD_ORDER.map((c) => {
            const cat = cats.find((x) => x.category === c);
            const inPlace = IN_PLACE.has(c);
            return {
                category: c,
                title: CARD_COPY[c].title,
                bytes: cat?.bytes ?? 0,
                detail: firstSentence(CARD_COPY[c].blurb),
                action: inPlace ? CARD_COPY[c].action : null,
                cleanableBytes: inPlace ? (cat?.cleanablebytes ?? 0) : 0,
                go: c === "canvases" ? "gallery" : inPlace ? null : "settings",
            };
        });
        const auto = i.storage.lastauto;
        storage = {
            arcBytes: cats.reduce((n, c) => n + c.bytes, 0) + (i.storage.storebytes ?? 0),
            cleanableBytes: rows.reduce((n, r) => n + r.cleanableBytes, 0),
            storeBytes: i.storage.storebytes ?? 0,
            rows,
            lastAuto: auto == null ? null : { bytes: auto.reclaimed, ts: auto.ts, error: auto.error ?? "" },
        };
    }
    let consumers: TraySnapshot["consumers"] = null;
    if (i.consumers != null) {
        const c = i.consumers;
        const rows = (c.agents ?? [])
            .map((a) => {
                const agent = i.agents.find((x) => x.blockId === a.blockid);
                return {
                    blockId: a.blockid,
                    name: agent?.name ?? "agent",
                    kind: agent?.agent ? `${providerLabel(agent.agent)} agent` : "Agent",
                    bytes: a.rambytes ?? null,
                    heaviest: a.heaviest
                        ? { pid: a.heaviest.pid, command: a.heaviest.command, bytes: a.heaviest.bytes }
                        : null,
                };
            })
            .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
        const own = [c.interfacebytes, c.serverbytes, c.hostbytes].reduce<number | null>(
            (n, b) => (b == null ? n : (n ?? 0) + b),
            null
        );
        const agentBytes = rows.reduce((n, r) => n + (r.bytes ?? 0), 0);
        const arc = agentBytes + (own ?? 0);
        consumers = {
            rows,
            ownBytes: own,
            arcBytes: arc,
            otherBytes: Math.max(0, c.totalbytes - c.availablebytes - arc),
        };
    }
    return {
        platform: i.platform,
        machine:
            m == null
                ? null
                : {
                      memTotal: m.memtotal,
                      memAvailable: m.memavailable,
                      pressure: level(m.pressure),
                      cpuPct: m.cpupct,
                      cpuSamples: m.cpusamples ?? [],
                      diskName: m.diskname,
                      diskTotal: m.disktotal,
                      diskFree: m.diskfree,
                  },
        jobs,
        jobsMode: paceValue(i.jobQueue),
        pausedLeftMs: pauseLeft(i.jobQueue, i.now),
        waits,
        waitsMore: Math.max(0, i.peekRows.length - MAX_WAITS),
        working: i.agents.filter((a) => a.state === "working").length,
        usage,
        storage,
        consumers,
        heardAt: i.heardAt,
    };
}

export function trayBadge(rows: PeekRow[], pressure: string): { count: number; alert: boolean } {
    return { count: rows.length, alert: pressure === "critical" };
}
