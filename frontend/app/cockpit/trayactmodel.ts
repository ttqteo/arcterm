// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the cockpit does for each TrayAct the popover sends (spec 2026-10-15-tray-popover-design.md), as data: whether
// to raise the main window first, then one step. Pure: traybridge.tsx carries the plan out. close, restart, quit,
// showlog and open-monitor are the host's (src-tauri/src/tray.rs) and plan to nothing.

import type { SurfaceKey } from "@/app/view/agents/agents";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { DEFAULT_SESSION_DAYS } from "@/app/view/agents/storagemodel";
import type { OpenTarget } from "@/app/view/jarvis/address";
import type { PetAct } from "@/app/view/jarvis/petacts";
import type { PeekRow } from "@/app/view/jarvis/petpeekmodel";
import { openTargetFor, pacePatch, pausePatch } from "./jobqueue";
import type { TrayAct, TrayPage } from "./traytypes";

export interface TrayActContext {
    peekRows: readonly PeekRow[];
    agents: readonly AgentVM[];
    jobQueue: JobQueueData | null;
    storage: StorageReport | null;
    now: number;
}

export type TrayStep =
    | { kind: "hello" } // the popover's page has loaded, maybe still hidden: send it a snapshot
    | { kind: "page"; page: TrayPage }
    | { kind: "nothing" } // only the raise
    | { kind: "settings"; section: string }
    | { kind: "surface"; surface: SurfaceKey }
    | { kind: "gallery" }
    | { kind: "act"; act: PetAct } // petactrun.runAct
    | { kind: "target"; target: OpenTarget } // openref.openTarget
    | { kind: "run-now"; id: string }
    | { kind: "skip"; id: string }
    | { kind: "config"; patch: SettingsType }
    | { kind: "stop"; blockid: string; pid: number }
    | { kind: "clean"; category: string; itemids: string[]; olderthandays?: number };

export interface TrayPlan {
    raise: boolean; // bring the main window forward first
    step: TrayStep;
}

const stay = (step: TrayStep): TrayPlan => ({ raise: false, step });
const raised = (step: TrayStep): TrayPlan => ({ raise: true, step });

// what Settings → Storage's card cleans (settingspages/storage.tsx runClean): the category's cleanable, unguarded
// items; the server re-checks each
function cleanableIds(storage: StorageReport | null, category: string): string[] {
    const cat = storage?.categories?.find((c) => c.category === category);
    return (cat?.items ?? []).filter((it) => it.cleanable && !it.guarded).map((it) => it.id);
}

export function trayActPlan(act: TrayAct, ctx: TrayActContext): TrayPlan | null {
    switch (act.kind) {
        case "hello":
            return stay({ kind: "hello" });
        case "page":
            return stay({ kind: "page", page: act.page });
        case "open-arcterm":
            return raised({ kind: "nothing" });
        case "open-wait": {
            const row = ctx.peekRows.find((r) => r.key === act.key);
            const escort = [row?.primary, ...(row?.links ?? [])].find((x) => x?.verb === "open");
            return raised(escort != null ? { kind: "act", act: escort } : { kind: "nothing" });
        }
        case "open-more":
            return raised({ kind: "surface", surface: "jarvis" });
        case "open-job": {
            const job = ctx.jobQueue?.jobs.find((j) => j.id === act.id);
            const target = job ? openTargetFor(job, ctx.agents) : null;
            return raised(target != null ? { kind: "target", target } : { kind: "nothing" });
        }
        case "open-agent": {
            const agent = ctx.agents.find((x) => x.blockId === act.blockId);
            return raised(
                agent != null
                    ? {
                          kind: "act",
                          act: {
                              id: `tray:${agent.id}`,
                              verb: "open",
                              label: "Open",
                              target: { kind: "oref", ref: `agent:${agent.id}` },
                          },
                      }
                    : { kind: "nothing" }
            );
        }
        case "open-storage-settings":
            return raised({ kind: "settings", section: "storage" });
        case "open-tray-settings":
            return raised({ kind: "settings", section: "general" });
        case "open-gallery":
            return raised({ kind: "gallery" });
        case "run-now":
            return stay({ kind: "run-now", id: act.id });
        case "skip":
            return stay({ kind: "skip", id: act.id });
        case "slots":
            return stay({ kind: "config", patch: pacePatch(act.value) });
        case "pause":
            return stay({ kind: "config", patch: pausePatch(act.ms, ctx.now) });
        case "stop":
            return stay({ kind: "stop", blockid: act.blockId, pid: act.pid });
        case "clean":
            return stay({
                kind: "clean",
                category: act.category,
                itemids: cleanableIds(ctx.storage, act.category),
                olderthandays: act.category === "sessions" ? Number(DEFAULT_SESSION_DAYS) : undefined,
            });
        default:
            return null; // close, restart, quit, showlog, open-monitor, shown: the host's
    }
}
