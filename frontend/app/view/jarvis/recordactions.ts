// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Every mutation of a record, and the one seam that keeps the reads honest afterwards. This module
// imports the record stores; nothing imports it but components, which is what keeps the stores from
// having to import each other. Mirrors view/agents/runactions.ts.

import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { reloadAmbient } from "@/app/view/agents/ambientstore";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { reloadRecordDetail, reloadRecordScope } from "./jarvissubjectstore";
import { isTerminalTransition } from "./tasksderive";
import { loadTaskList, tasksErrorAtom } from "./tasksstore";

// Refresh every cache of this record that a write can invalidate. The ambient re-read is deliberately not
// awaited: ResolveAmbient sweeps every dossier against every run and shells out to git for commit
// subjects, which is why its call site carries a 30s budget. Blocking a click on that would be worse than
// a tag that updates a beat late.
export async function afterRecordWrite(dossierId: string): Promise<void> {
    reloadAmbient();
    await Promise.all([reloadRecordDetail(dossierId), reloadRecordScope(dossierId)]);
}

// A write that fails must say so rather than leaving the UI asserting a change that did not happen.
// tasksErrorAtom is the surface's existing channel for that.
async function write(dossierId: string, op: () => Promise<void>): Promise<boolean> {
    try {
        await op();
        await afterRecordWrite(dossierId);
        return true;
    } catch (e) {
        globalStore.set(tasksErrorAtom, String(e));
        return false;
    }
}

export function appendDecision(
    dossierId: string,
    summary: string,
    rationale: string,
    links: string[]
): Promise<boolean> {
    return write(dossierId, async () => {
        await RpcApi.AppendDossierDecisionCommand(TabRpcClient, {
            dossierid: dossierId,
            summary,
            rationale,
            links,
        });
    });
}

export function setDossierStatus(dossierId: string, status: string): void {
    fireAndForget(() =>
        write(dossierId, async () => {
            await RpcApi.SetDossierStatusCommand(TabRpcClient, { dossierid: dossierId, status });
            // the row can change group or leave the list entirely, which the record's own caches cannot show
            loadTaskList();
        })
    );
}

// setDossierStatus behind the guard the peek and the record detail apply: a terminal status confirms first.
// For callers with no dialog of their own to render (the palette).
export function confirmDossierStatus(dossierId: string, status: string): void {
    if (!isTerminalTransition(status)) {
        setDossierStatus(dossierId, status);
        return;
    }
    modalsModel.pushModal("ConfirmModal", {
        title: `Mark this record ${status}?`,
        message: `This sets the record's status to "${status}". You can reactivate it later.`,
        confirmLabel: `Yes, ${status}`,
        destructive: status === "archived",
        onConfirm: () => setDossierStatus(dossierId, status),
    });
}

// One suppressed edge. Deliberately not AmbientTag: that shape has a taskId and no run oref, so a
// record-scoped read — where every row shares the same record and the RUN is the distinguishing datum —
// would render N identical rows and drop the id Restore needs. Both ids travel; each view picks the one
// that varies.
export interface DetachedEdge {
    dossierId: string;
    runORef: string;
    label: string;
    bucket: string;
}

// Keyed by "task:<dossierId>" for a record's suppressed runs, or by a run oref for that run's suppressed
// records. Two keys into one atom because the two views ask the inverse question and the answer for one
// says nothing about the other.
export const detachedEdgesAtom = atom<Record<string, DetachedEdge[]>>({}) as PrimitiveAtom<
    Record<string, DetachedEdge[]>
>;

function detachedRequest(key: string): CommandListDetachedEdgesData {
    return key.startsWith("task:") ? { dossierid: key.slice("task:".length) } : { runoref: key };
}

export function loadDetachedEdges(key: string): void {
    fireAndForget(async () => {
        try {
            const rtn = await RpcApi.ListDetachedEdgesCommand(TabRpcClient, detachedRequest(key));
            const labels = new Map((rtn?.tasks ?? []).map((t) => [t.id, t.label]));
            const rows: DetachedEdge[] = (rtn?.edges ?? []).map((e) => ({
                dossierId: e.dossierid,
                runORef: e.oref,
                label: labels.get(e.dossierid) ?? e.dossierid,
                bucket: e.bucket,
            }));
            globalStore.set(detachedEdgesAtom, { ...globalStore.get(detachedEdgesAtom), [key]: rows });
        } catch (e) {
            // a missing undo list must not break the view it decorates
            console.warn("detached edges unavailable", e);
        }
    });
}

// A correction invalidates the caches of the record AND both detached lists that could show it — the
// record's own, and the run's, which a channel's band reads.
async function afterEdgeWrite(dossierId: string, runORef: string): Promise<void> {
    await afterRecordWrite(dossierId);
    loadDetachedEdges("task:" + dossierId);
    loadDetachedEdges(runORef);
}

export function detachEdge(dossierId: string, runORef: string): void {
    fireAndForget(async () => {
        try {
            await RpcApi.DetachDossierEdgeCommand(TabRpcClient, { dossierid: dossierId, runoref: runORef });
            await afterEdgeWrite(dossierId, runORef);
        } catch (e) {
            globalStore.set(tasksErrorAtom, String(e));
        }
    });
}

// One call serves Confirm, Restore and Attach: accepting a pair with no existing edge appends the override
// and hardens the run into the record's refs block, which is a canonical layer-1 edge on the next read.
export function acceptEdge(dossierId: string, runORef: string): void {
    fireAndForget(async () => {
        try {
            await RpcApi.AcceptDossierEdgeCommand(TabRpcClient, { dossierid: dossierId, runoref: runORef });
            await afterEdgeWrite(dossierId, runORef);
        } catch (e) {
            globalStore.set(tasksErrorAtom, String(e));
        }
    });
}
