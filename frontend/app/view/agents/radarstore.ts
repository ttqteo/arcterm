// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import * as WOS from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { DEFAULT_OPEN_LIST_GROUPS, type RadarListGroup } from "./radarmodel";

export interface RadarScope {
    name: string;
    path: string;
}

// resolveScope maps the cockpit's global project FILTER (a project name, or "all") to Radar's
// name+path scope. Returns null when there is no single registered project to scan.
export function resolveScope(filter: string, projects: Record<string, ProjectKeywords>): RadarScope | null {
    if (!filter || filter === "all") {
        return null;
    }
    const path = projects?.[filter]?.path;
    if (!path) {
        return null;
    }
    return { name: filter, path };
}

// The project Radar is scoped to, persisted across reloads. Stores the project NAME only — the path is
// re-resolved from the registry so the registry stays the single source of truth for paths.
export const lastRadarProjectAtom = atomWithStorage<string | null>("radar.scope.project", null);

export type InitScopeDecision = { action: "keep" } | { action: "wait" } | { action: "set"; scope: RadarScope | null };

// pickInitialScope decides how RadarSurface should initialize its scope on mount. An already-owned scope
// is kept untouched (a remount must not re-derive it — that clobbered the current scan). Otherwise it
// prefers the persisted project, then the cockpit's global filter, resolving name->path via the registry;
// it waits when a desired project can't be resolved yet (registry not loaded, or the project was removed).
export function pickInitialScope(
    owned: RadarScope | null,
    persisted: string | null,
    filter: string,
    projects: Record<string, ProjectKeywords>
): InitScopeDecision {
    if (owned != null) {
        return { action: "keep" };
    }
    const desired = persisted ?? (filter !== "all" ? filter : null);
    if (!desired) {
        return { action: "set", scope: null };
    }
    const scope = resolveScope(desired, projects);
    if (!scope) {
        return { action: "wait" };
    }
    return { action: "set", scope };
}

// A report names its own project, so a scope built from it needs no registry — which is what lets Radar land
// on a report before the project registry has loaded.
export function scopeOfReport(report: RadarReport): RadarScope {
    return { name: report.projectname || report.projectpath, path: report.projectpath };
}

// findNewestScannedProject asks the backend for every radar report (newest-first) and returns a scope for
// the most-recently-scanned project, so a fresh Radar tab lands on real results instead of an empty picker.
// Built straight from the report's stored name+path — no registry dependency, so it works before the
// project registry has loaded. Returns null when nothing has ever been scanned; a failed query rejects.
export async function findNewestScannedProject(): Promise<RadarScope | null> {
    const rtn = await RpcApi.ListRadarReportsCommand(TabRpcClient, { projectpath: "" });
    const newest = (rtn.reports ?? []).slice().sort((a, b) => b.startedts - a.startedts)[0];
    if (!newest?.projectpath) {
        return null;
    }
    return scopeOfReport(newest);
}

export const radarScopeAtom = atom<RadarScope | null>(null) as PrimitiveAtom<RadarScope | null>;
export const radarReportsAtom = atom<RadarReport[] | null>(null) as PrimitiveAtom<RadarReport[] | null>;
// A failed report read. Kept apart from radarReportsAtom so a failure never reads as "never scanned".
export const radarLoadErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const currentReportIdAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;

// Selected finding id. An atom (not surface-local useState) so the selection survives RadarSurface
// unmounting on nav-rail switch — mirrors Sessions/Files (see docs cockpit coherence audit).
export const radarSelectedIdAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;

// The open list groups: an atom for the same reason as the selection.
export const radarOpenListGroupsAtom = atom<Set<RadarListGroup>>(new Set(DEFAULT_OPEN_LIST_GROUPS)) as PrimitiveAtom<
    Set<RadarListGroup>
>;

// DEV-ONLY: when set, fully replaces the live current report (see radardevmock.ts); "none" forces "no
// report" on a project that has one. null in prod.
export const radarDevMockAtom = atom<RadarReport | "none" | null>(null) as PrimitiveAtom<RadarReport | "none" | null>;

// Current report: the dev-mock override if present, else the WOS-pinned live report (so an in-flight
// scan streams status/phase/audit updates without polling).
export const currentReportAtom: Atom<RadarReport | null> = atom((get) => {
    const mock = get(radarDevMockAtom);
    if (mock) {
        return mock === "none" ? null : mock;
    }
    const id = get(currentReportIdAtom);
    if (!id) {
        return null;
    }
    return get(WOS.getWaveObjectAtom<RadarReport>(WOS.makeORef("radarreport", id))) ?? null;
});

// The id of the report currentReportAtom shows. The load phase reads this rather than currentReportIdAtom,
// so a forced "no report" is not read as a report that is still loading.
export const shownReportIdAtom: Atom<string | undefined> = atom((get) => {
    const mock = get(radarDevMockAtom);
    if (mock) {
        return mock === "none" ? undefined : mock.oid;
    }
    return get(currentReportIdAtom);
});

// In-flight report loads, by path. A repeat for the same path is dropped; a load for another path is not,
// because a landing that re-scopes Radar has to get its own list rather than return with none.
const loadingPaths = new Set<string>();

// loadReports fetches the report list for a path (newest-first) and selects the newest.
export async function loadReports(path: string): Promise<void> {
    if (loadingPaths.has(path)) {
        return;
    }
    loadingPaths.add(path);
    try {
        const rtn = await RpcApi.ListRadarReportsCommand(TabRpcClient, { projectpath: path });
        // the scope moved while this was in flight: its newest report would land over the scope that replaced it
        if (globalStore.get(radarScopeAtom)?.path !== path) {
            return;
        }
        globalStore.set(radarLoadErrorAtom, null);
        const list = (rtn.reports ?? []).slice().sort((a, b) => b.startedts - a.startedts);
        globalStore.set(radarReportsAtom, list);
        if (list.length > 0) {
            await selectReport(list[0].oid);
        } else {
            globalStore.set(currentReportIdAtom, undefined);
        }
    } catch (err) {
        console.error("loading radar reports failed", err);
        if (globalStore.get(radarScopeAtom)?.path === path) {
            globalStore.set(radarLoadErrorAtom, `Couldn't read Radar reports: ${String(err)}`);
        }
    } finally {
        loadingPaths.delete(path);
    }
}

// selectReport pins the report in WOS (so subsequent SendWaveObjUpdate deltas apply) and marks it current.
export async function selectReport(reportId: string): Promise<void> {
    await WOS.loadAndPinWaveObject<RadarReport>(WOS.makeORef("radarreport", reportId));
    globalStore.set(currentReportIdAtom, reportId);
}

// initRadarScope sets the owned scope and loads its reports. Clearing scope (null) leaves a loaded, empty list.
// The scoped project name is persisted (across reloads) so a return to Radar restores the same scan.
export async function initRadarScope(scope: RadarScope | null): Promise<void> {
    globalStore.set(radarScopeAtom, scope);
    globalStore.set(lastRadarProjectAtom, scope?.name ?? null);
    if (!scope) {
        globalStore.set(radarReportsAtom, []);
        globalStore.set(currentReportIdAtom, undefined);
        return;
    }
    await loadReports(scope.path);
}

// First landing with no persisted scope: the newest-scanned project, or none. A failed lookup is a load
// error, not a never-scanned landing.
export async function initRadarScopeFromNewest(): Promise<void> {
    let scope: RadarScope | null;
    try {
        scope = await findNewestScannedProject();
    } catch (err) {
        console.error("finding newest scanned project failed", err);
        globalStore.set(radarLoadErrorAtom, `Couldn't read Radar reports: ${String(err)}`);
        return;
    }
    await initRadarScope(scope);
}

// The load-error banner's retry: re-reads whichever load failed.
export async function retryRadarLoad(): Promise<void> {
    globalStore.set(radarLoadErrorAtom, null);
    const scope = globalStore.get(radarScopeAtom);
    if (scope != null) {
        await loadReports(scope.path);
        return;
    }
    await initRadarScopeFromNewest();
}

// startScan kicks a scan for path; the returned report is pinned + selected so its live scan streams in.
export async function startScan(path: string): Promise<void> {
    const rtn = await RpcApi.StartRadarScanCommand(TabRpcClient, { projectpath: path });
    await loadReports(path);
    await selectReport(rtn.report.oid);
}

export async function cancelScan(reportId: string): Promise<void> {
    await RpcApi.CancelRadarScanCommand(TabRpcClient, { reportid: reportId });
}

// the RPC keeps its old name: it re-audits the report's failed commits
export async function retryFailedAudits(reportId: string): Promise<void> {
    await RpcApi.RetryRadarClusteringCommand(TabRpcClient, { reportid: reportId });
}

// setDisposition applies dismiss/suppress/reopen; the report update round-trips via WOS.
export async function setDisposition(
    reportId: string,
    findingId: string,
    action: string,
    reason?: string,
    note?: string
): Promise<void> {
    await RpcApi.SetRadarFindingDispositionCommand(TabRpcClient, {
        reportid: reportId,
        findingid: findingId,
        action,
        reason,
        note,
    });
}
