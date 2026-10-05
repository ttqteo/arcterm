// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTabBadgeAtom } from "@/app/store/badge";
import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { WorkspaceService } from "@/app/store/services";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom } from "jotai";
import { showTerminal } from "../agentcenter";
import type { AgentsViewModel } from "../agents";
import type { PendingLaunch } from "../agentsviewmodel";
import { getAgentStatusAtom, getSubagentExpandAtom } from "./agentstatusstore";
import { sessionGroupLabelAtom } from "./sessiongroupstore";
import {
    badgeToStatus,
    buildDuplicateBlockMeta,
    buildSessionViewModel,
    cwdToServiceLabel,
    findSessionTermBlock,
    reorderWithinGroup,
    sessionRunORef,
    subagentExpanded,
    type ResolvedSessionBlock,
    type SessionInput,
    type SessionStatus,
    type SessionTermBlock,
    type SidebarViewModel,
    type SubagentVM,
} from "./sessionviewmodel";

/** Resolve a tab's block ids to block objects. Only resolves ids — the identity predicate lives in
 *  findSessionTermBlock so all sites share one rule. */
function resolveTabBlocks(
    tab: Tab | null | undefined,
    readBlock: (blockId: string) => Block | null | undefined
): ResolvedSessionBlock[] {
    return (tab?.blockids ?? []).map((blockId) => ({ blockId, block: readBlock(blockId) }));
}

/** Derived: collect per-tab data reactively and build the grouped view model. */
export const sessionSidebarViewModelAtom = atom<SidebarViewModel>((get) => {
    const ws = get(atoms.workspace);
    const tabIds = ws?.tabids ?? [];
    const activeId = ws?.activetabid;
    const labelMap = get(sessionGroupLabelAtom);

    const sessions: SessionInput[] = tabIds.map((tabId) => {
        const tab = get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
        const badges = get(getTabBadgeAtom(tabId));

        const blocks = resolveTabBlocks(tab, (blockId) =>
            get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)))
        );
        const termBlock = findSessionTermBlock(blocks);
        const scannedBlocks =
            termBlock == null
                ? blocks
                : blocks.slice(0, blocks.findIndex(({ blockId }) => blockId === termBlock.blockId) + 1);
        // preserve the prior loop's break at the first session terminal: blocks after it don't set isAgentsTab
        const isAgentsTab = scannedBlocks.some(({ block }) => block?.meta?.view === "agents");
        const cwd = termBlock?.cwd;
        const termBlockId = termBlock?.blockId;

        const badgeStatus = badgeToStatus(badges?.[0]);
        let status: SessionStatus = badgeStatus;
        let detail: string | undefined;
        let model: string | undefined;
        let title: string | undefined;
        let subagents: SubagentVM[] = [];
        let subagentsExpanded = false;
        let termBlockOref: string | undefined;
        if (termBlockId) {
            termBlockOref = WOS.makeORef("block", termBlockId);
            const agentStatus = get(getAgentStatusAtom(termBlockOref));
            if (agentStatus?.state) {
                status = agentStatus.state as SessionStatus;
                detail = agentStatus.detail;
            }
            model = agentStatus?.model;
            title = agentStatus?.title;
            subagentsExpanded = subagentExpanded(subagents, get(getSubagentExpandAtom(termBlockOref)));
        }

        const meta = tab?.meta ?? {};
        return {
            tabId,
            name: tab?.name ?? "",
            agent: meta["session:agent"],
            customLabel: meta["session:label"],
            projectLabel: meta["session:project"],
            runORef: sessionRunORef(meta, termBlock?.meta),
            effortORef: meta["session:effort"],
            title,
            pinned: meta["session:pinned"] === true,
            isAgentsTab,
            cwd,
            serviceLabel: (cwd && labelMap.get(cwd)) || cwdToServiceLabel(cwd),
            status,
            detail,
            model,
            subagents,
            subagentsExpanded,
            termBlockOref,
            active: tabId === activeId,
        };
    });

    return buildSessionViewModel(sessions);
});

export const sessionCwdsAtom = atom<string[]>((get) => {
    const ws = get(atoms.workspace);
    const tabIds = ws?.tabids ?? [];
    const cwds: string[] = [];
    for (const tabId of tabIds) {
        const tab = get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
        const termBlock = findSessionTermBlock(
            resolveTabBlocks(tab, (blockId) => get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId))))
        );
        if (termBlock != null) {
            cwds.push(termBlock.cwd);
        }
    }
    return cwds;
});

export function togglePin(tabId: string, pinned: boolean) {
    fireAndForget(() =>
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("tab", tabId),
            meta: { "session:pinned": !pinned },
        })
    );
}

/** The custom label stored on this session, or "" when it has none and the row is showing an auto
 *  label. A rename box seeds from this rather than from the rendered row label: that label can be an
 *  ai-title, a project name, or carry a " · service" suffix (rowLabel), and re-submitting any of
 *  those would pin it as a manual name the auto label can never take back. Read imperatively — the
 *  seed is a snapshot taken when the box opens, not something it should track. */
export function sessionCustomLabel(tabId: string): string {
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    return tab?.meta?.["session:label"] ?? "";
}

/** Set (or clear, when empty) the session's custom label. Null reverts the row to its auto label. */
export function renameSession(tabId: string, name: string) {
    const trimmed = name.trim();
    fireAndForget(() =>
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("tab", tabId),
            meta: { "session:label": trimmed.length > 0 ? trimmed : null },
        })
    );
}

/** Reactive: the collapsed group labels persisted on the workspace. */
export const collapsedGroupsAtom = atom<string[]>((get) => {
    const ws = get(atoms.workspace);
    return ws?.meta?.["session:collapsedgroups"] ?? [];
});

export function setCollapsedGroups(groups: string[]) {
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null) {
        return;
    }
    fireAndForget(() =>
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("workspace", ws.oid),
            meta: { "session:collapsedgroups": groups },
        })
    );
}

/** The active session's terminal block id + cwd (the block the diff-split targets). */
export function findActiveSessionTermBlock(): { blockId: string; cwd: string } | undefined {
    const ws = globalStore.get(atoms.workspace);
    const activeId = ws?.activetabid;
    if (activeId == null) {
        return undefined;
    }
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", activeId)));
    const termBlock = findSessionTermBlock(
        resolveTabBlocks(tab, (blockId) =>
            globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)))
        )
    );
    if (termBlock == null) {
        return undefined;
    }
    return { blockId: termBlock.blockId, cwd: termBlock.cwd };
}

/** The active tab's loom block id (the one stamped with app:loom), if open. */
export function findActiveLoomBlockId(): string | undefined {
    const ws = globalStore.get(atoms.workspace);
    const activeId = ws?.activetabid;
    if (activeId == null) {
        return undefined;
    }
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", activeId)));
    for (const blockId of tab?.blockids ?? []) {
        const block = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
        if (block?.meta?.["app:loom"]) {
            return blockId;
        }
    }
    return undefined;
}

/** Resolve a tab's terminal block (the session block) — same rule the sidebar groups on. */
function resolveSessionTermBlock(tabId: string): SessionTermBlock | undefined {
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    return findSessionTermBlock(
        resolveTabBlocks(tab, (blockId) =>
            globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)))
        )
    );
}

/** Reorder a session within its group by rewriting the workspace tab order (shared with the tab bar).
 *  No-op when the computed order is unchanged or the workspace is missing. */
export function reorderSession(memberIds: string[], draggedId: string, targetId: string, placeBefore: boolean) {
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null) {
        return;
    }
    const tabIds = ws.tabids ?? [];
    const next = reorderWithinGroup(tabIds, memberIds, draggedId, targetId, placeBefore);
    if (next.length === tabIds.length && next.every((id, i) => id === tabIds[i])) {
        return;
    }
    fireAndForget(() => RpcApi.UpdateWorkspaceTabIdsCommand(TabRpcClient, ws.oid, next));
}

/** Close every tab in a group after a single confirmation. Callers pass only cwd groups (never the
 *  pinned group), so the Agents tab is never bulk-closed. */
export function closeGroup(label: string, memberIds: string[]) {
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null || memberIds.length === 0) {
        return;
    }
    const noun = memberIds.length === 1 ? "tab" : "tabs";
    modalsModel.pushModal("ConfirmModal", {
        title: "Close group",
        message: `Close ${memberIds.length} ${noun} in "${label}"? This can't be undone.`,
        confirmLabel: `Close ${noun}`,
        destructive: true,
        onConfirm: () => {
            for (const tabId of memberIds) {
                fireAndForget(() => WorkspaceService.CloseTab(ws.oid, tabId));
            }
        },
    });
}

/** Duplicate a session: open a new tab that re-launches the same agent in the same cwd as the source.
 *  Clones the source term block's launch meta onto the new tab's default block *before* it renders, then
 *  surfaces + focuses the clone exactly like launchAgent — a pending roster row so it shows immediately,
 *  plus focusIdAtom/surfaceAtom so its terminal mounts and the controller starts. The cockpit renders
 *  agents in-place via the focus pane, so the old setActiveTab path is a dead no-op stub under Tauri. */
export function duplicateSession(model: AgentsViewModel, sourceTabId: string) {
    const source = resolveSessionTermBlock(sourceTabId);
    if (source == null) {
        return;
    }
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null) {
        return;
    }
    const srcTab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", sourceTabId)));
    const agent = srcTab?.meta?.["session:agent"];
    const project = srcTab?.meta?.["session:project"];
    const name = srcTab?.name ?? "";
    const blockMeta = buildDuplicateBlockMeta(source.meta);
    fireAndForget(async () => {
        const newTabId = await WorkspaceService.CreateTab(ws.oid, name, false);
        const newTab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", newTabId)));
        const defaultBlockId = newTab?.blockids?.[0];
        if (defaultBlockId == null) {
            return;
        }
        const blockORef = WOS.makeORef("block", defaultBlockId);
        await RpcApi.SetMetaCommand(TabRpcClient, { oref: blockORef, meta: blockMeta });
        // getWaveObjectAtom is a one-time fetch (no subscription); reload so the session sidebar sees the
        // cloned cmd:cwd and the tab enters the roster (without this the clone never surfaces).
        await WOS.reloadWaveObject(blockORef);
        const tabMeta: Record<string, any> = {};
        if (agent != null) {
            tabMeta["session:agent"] = agent;
        }
        if (project != null) {
            tabMeta["session:project"] = project;
        }
        if (Object.keys(tabMeta).length > 0) {
            await RpcApi.SetMetaCommand(TabRpcClient, { oref: WOS.makeORef("tab", newTabId), meta: tabMeta });
        }
        // agent panel gets a pending roster row so the clone appears before the reporter registers it.
        if (agent != null) {
            const pending: PendingLaunch = {
                tabId: newTabId,
                blockId: defaultBlockId,
                name,
                project: project ?? "",
                ts: Date.now(),
            };
            globalStore.set(model.pendingLaunchesAtom, [...globalStore.get(model.pendingLaunchesAtom), pending]);
        }
        // Focus into the Agent surface so the clone's terminal mounts and its controller starts.
        globalStore.set(model.focusIdAtom, newTabId);
        globalStore.set(model.surfaceAtom, "agent");
        showTerminal();
    });
}
