// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { getSettingsKeyAtom } from "@/app/store/global";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect, useRef } from "react";
import type { AgentsViewModel } from "./agents";
import { AgentSurface } from "./agentsurface";
import { primeChannels } from "./channelsstore";
import { initHarnessPreference, loadHarnesses } from "./harnessstore";
import { CodeSurface } from "@/app/view/code/codesurface";
import { CockpitSurface } from "./cockpitsurface";
import { useDocCompileSync } from "./docpdfstore";
import { DocReviewDialog } from "./docreviewdialog";
import { useDocReviewSync } from "./docreviewstore";
import { FilesSurface } from "./filessurface";
import { setupRosterSeededLatch } from "./liveagents";
import { JarvisSurface } from "@/app/view/jarvis/jarvissurface";
import { NavRail } from "./navrail";
import { RadarSurface } from "./radarsurface";
import { SettingsSurface } from "./settingssurface";
import { SetupSurface } from "./setupsurface";
import { UsageSurface } from "./usagesurface";

// One always-mounted synchronization hook: seed the shared preferred-harness state from the persisted
// setting and load the harness catalog once at boot, so every surface reads the same selection.
function useHarnessPreference() {
    useEffect(() => {
        const persisted = (globalStore.get(getSettingsKeyAtom("harness:preferredruntime")) as string) ?? "";
        const persistedModel = (globalStore.get(getSettingsKeyAtom("harness:preferredmodel")) as string) ?? "";
        initHarnessPreference(persisted, persistedModel);
        fireAndForget(loadHarnesses);
    }, []);
}

// Clears a pending launch once it's no longer "booting": its real roster row arrived (tabId in the
// base roster) OR its tab was closed (was present in the workspace, now gone). The seen-present ref
// avoids a creation race — a tab is only pruned-on-close after we've observed it present at least once.
function usePrunePendingLaunches(model: AgentsViewModel) {
    const ws = useAtomValue(atoms.workspace);
    const base = useAtomValue(model.baseRosterAtom);
    const pending = useAtomValue(model.pendingLaunchesAtom);
    const seenRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        const tabIds = new Set(ws?.tabids ?? []);
        const baseIds = new Set(base.map((a) => a.id));
        for (const p of pending) {
            if (tabIds.has(p.tabId)) {
                seenRef.current.add(p.tabId);
            }
        }
        const next = pending.filter(
            (p) => !baseIds.has(p.tabId) && !(seenRef.current.has(p.tabId) && !tabIds.has(p.tabId))
        );
        if (next.length !== pending.length) {
            globalStore.set(model.pendingLaunchesAtom, next);
        }
    }, [ws?.tabids, base, pending, model]);
}

// Delete one agent's entry from a per-agent record atom (no-op if absent).
function deleteKey<T>(atomRef: PrimitiveAtom<Record<string, T>>, id: string) {
    const prev = globalStore.get(atomRef);
    if (!(id in prev)) {
        return;
    }
    const next = { ...prev };
    delete next[id];
    globalStore.set(atomRef, next);
}

// Resets an agent's answer drafts (selection/text/tab) when its ask identity (askId) changes, so a fresh
// ask never inherits the previous ask's drafts (T1). Lives in the always-mounted shell so it fires on any
// surface that answers asks (cockpit grid AND Channels rows), not just when the cockpit is open. The first
// sighting of an ask clears nothing (drafts are already empty) and just records the id.
function useResetAnswerDraftsOnAskChange(model: AgentsViewModel) {
    const agents = useAtomValue(model.agentsAtom);
    const seenRef = useRef<Map<string, string>>(new Map());
    const asks = agents.flatMap((a) => (a.ask?.askId != null ? [{ id: a.id, askId: a.ask.askId }] : []));
    useEffect(() => {
        for (const { id, askId } of asks) {
            if (seenRef.current.get(id) === askId) {
                continue;
            }
            seenRef.current.set(id, askId);
            deleteKey(model.answerSelAtom, id);
            deleteKey(model.answerTextAtom, id);
            deleteKey(model.answerTabAtom, id);
        }
    }, [asks.map((a) => `${a.id}:${a.askId}`).join(",")]);
}

export function CockpitShell({ model, tabId }: { model: AgentsViewModel; tabId: string }) {
    usePrunePendingLaunches(model);
    useResetAnswerDraftsOnAskChange(model);
    // a Doc review's state follows its ask from here, so one answered or cleared on any surface clears it
    useDocReviewSync(model);
    // after the sync, so a new .tex review's state exists: its PDF compiles in the background, on any surface
    useDocCompileSync(model);
    useHarnessPreference();
    // prime the channel snapshot at boot so the nav-rail needs-you badge + Cockpit counters dedup
    // correctly even before the Channels surface is first opened.
    useEffect(() => {
        fireAndForget(primeChannels);
    }, []);
    // the roster's first-load gate; here rather than at boot, because boot subscribes before the workspace loads
    useEffect(() => setupRosterSeededLatch(), []);
    const surface = useAtomValue(model.surfaceAtom);
    return (
        <div className="flex h-full w-full">
            <NavRail model={model} />
            <div className="relative min-w-0 flex-1 bg-background">
                {/* Agent surface stays mounted so its live terminal is never torn down on tab switch
                    (destroy+remount re-fits xterm at a stale size and mangles the TUI). Hidden via
                    display:none when off-surface; the termwrap resize guard skips the 0-size fit. */}
                <div className={cn("absolute inset-0", surface === "agent" ? "" : "hidden")}>
                    <AgentSurface model={model} tabId={tabId} />
                </div>
                {surface !== "agent" ? (
                    <div className="absolute inset-0">
                        {surface === "cockpit" ? (
                            <CockpitSurface model={model} />
                        ) : surface === "jarvis" ? (
                            <JarvisSurface model={model} />
                        ) : surface === "radar" ? (
                            <RadarSurface model={model} />
                        ) : surface === "files" ? (
                            <FilesSurface model={model} />
                        ) : surface === "usage" ? (
                            <UsageSurface model={model} />
                        ) : surface === "code" ? (
                            <CodeSurface model={model} />
                        ) : surface === "setup" ? (
                            <SetupSurface model={model} />
                        ) : surface === "settings" ? (
                            <SettingsSurface model={model} />
                        ) : null}
                    </div>
                ) : null}
            </div>
            {/* outside the surface switch: a lead's review opens over whichever surface is showing */}
            <DocReviewDialog model={model} />
        </div>
    );
}
